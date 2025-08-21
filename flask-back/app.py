from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from datetime import datetime
from scapy.all import ARP, Ether, srp
from collections import deque
import psutil
import os
import json
import paramiko
import re
import subprocess
import time
import urllib.request
import ssl
import ipaddress
import netifaces
import logging
import socket
import pathlib
import openstack
import shlex
from typing import Optional
import threading
import uuid
import zipfile

app = Flask(__name__)
CORS(app, supports_credentials=True)

# Store last 60 seconds of CPU, Memory, and Bandwidth usage
timestamped_cpu_history = deque(maxlen=60)
timestamped_memory_history = deque(maxlen=60)
timestamped_bandwidth_history = deque(maxlen=60)

def add_cpu_history(cpu_percent):
    timestamped_cpu_history.append({
        "timestamp": int(time.time()),
        "cpu": cpu_percent
    })

def add_memory_history(mem_percent):
    timestamped_memory_history.append({
        "timestamp": int(time.time()),
        "memory": mem_percent
    })

def get_cpu_history():
    return [
        {
            "timestamp": entry["timestamp"],
            "cpu": entry["cpu"] * 100 if entry["cpu"] <= 1.5 else entry["cpu"],
        }
        for entry in timestamped_cpu_history
    ]

def get_memory_history():
    return [
        {
            "timestamp": entry["timestamp"],
            "memory": entry["memory"] * 100 if entry["memory"] <= 1.5 else entry["memory"],
        }
        for entry in timestamped_memory_history
    ]

# Add bandwidth history
last_bandwidth = {'rx': 0, 'tx': 0, 'timestamp': 0}
def add_bandwidth_history(interface):
    global last_bandwidth
    rx, tx = get_bandwidth(interface)
    now = int(time.time())
    if rx is None or tx is None:
        return
    if last_bandwidth['timestamp'] == 0:
        last_bandwidth = {'rx': rx, 'tx': tx, 'timestamp': now}
        return
    elapsed = now - last_bandwidth['timestamp']
    if elapsed <= 0:
        return
    bandwidth_kbps = ((rx - last_bandwidth['rx']) + (tx - last_bandwidth['tx'])) / 1024 / elapsed
    timestamped_bandwidth_history.append({
        "timestamp": now,
        "bandwidth_kbps": round(bandwidth_kbps, 2),
        "interface": interface
    })
    last_bandwidth = {'rx': rx, 'tx': tx, 'timestamp': now}

def get_bandwidth_history():
    return list(timestamped_bandwidth_history)

# ------------------------------------------------ Server Validation Start --------------------------------------------
#  Validation criteria
ENV_REQUIREMENTS = {
    "development": {
        "cpu_cores": 2,
        "memory_gb": 3,
        "disks": 0,
        "network": 1,
    },
    # "development": {
    #     "cpu_cores": 8,
    #     "memory_gb": 32,
    #     "disks": 2,
    #     "network": 2,
    # },
    # "production": {
    #     "cpu_cores": 48,
    #     "memory_gb": 128,
    #     "disks": 4,
    #     "network": 2,
    # },
    "production": {
        "cpu_cores": 12,
        "memory_gb": 16,
        "disks": 2,
        "network": 2,
    },
}


# ---------- Local Validation ----------
def validate_local(env_type):
    requirements = ENV_REQUIREMENTS.get(env_type)
    if not requirements:
        return {"error": "Invalid environment type"}, 400

    cpu_cores = psutil.cpu_count(logical=False)
    memory_gb = round(psutil.virtual_memory().total / (1024**3))

    disk_partitions = psutil.disk_partitions()
    data_disks = [
        d
        for d in disk_partitions
        if not d.mountpoint.startswith("/boot") and "boot" not in d.device.lower()
    ]
    data_disks = [
        d
        for d in data_disks
        if psutil.disk_usage(d.mountpoint).total > 500 * 1024**3 and d.mountpoint != "/"
    ]

    net_ifaces = psutil.net_if_addrs()
    network_count = len([iface for iface in net_ifaces if iface != "lo"])

    validation = {
        "cpu": cpu_cores >= requirements["cpu_cores"],
        "memory": memory_gb >= requirements["memory_gb"],
        "disks": len(data_disks) >= requirements["disks"],
        "network": network_count >= requirements["network"],
    }

    result_status = "passed" if all(validation.values()) else "failed"

    result = {
        "cpu_cores": cpu_cores,
        "memory_gb": memory_gb,
        "data_disks": len(data_disks),
        "network_interfaces": network_count,
        "validation": validation,
        "validation_result": result_status,
    }
    return result, 200


# ---------- Remote SSH Validation ----------
def validate_remote(env_type, host, username, pem_path):
    requirements = ENV_REQUIREMENTS.get(env_type)
    if not requirements:
        return {"error": "Invalid environment type"}, 400

    try:
        key = paramiko.RSAKey.from_private_key_file(pem_path)
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(hostname=host, username=username, pkey=key)

        commands = {
            "cpu": "nproc --all",
            "memory": "free -g | awk '/Mem:/ {print $2}'",
            "disks": 'BOOT_DISK=$(lsblk -no PKNAME $(findmnt -no SOURCE /boot/efi)); lsblk -nd -o NAME | grep -v "$BOOT_DISK" | wc -l',
            "network": 'ls -d /sys/class/net/* | grep -v lo | while read iface; do if [ -e "$iface/device" ]; then basename "$iface"; fi; done | wc -l',
        }

        results = {}
        for key, cmd in commands.items():
            stdin, stdout, stderr = ssh.exec_command(cmd)
            output = stdout.read().decode().strip()
            results[key] = int(re.findall(r"\d+", output)[0])

        ssh.close()

        validation = {
            "cpu": results["cpu"] >= requirements["cpu_cores"],
            "memory": results["memory"] >= requirements["memory_gb"],
            "disks": results["disks"] >= requirements["disks"],
            "network": results["network"] >= requirements["network"],
        }

        result_status = "passed" if all(validation.values()) else "failed"

        result = {
            "cpu_cores": results["cpu"],
            "memory_gb": results["memory"],
            "data_disks": results["disks"],
            "network_interfaces": results["network"],
            "validation": validation,
            "validation_result": result_status,
        }

        return result, 200

    except Exception as e:
        return {"error": str(e)}, 500


# ---------- API Endpoint ----------
@app.route("/validate", methods=["POST"])
def validate():
    data = request.json
    env_type = data.get("environment")
    mode = data.get("mode")

    if mode == "local":
        return jsonify(*validate_local(env_type))
    elif mode == "remote":
        host = data.get("host")
        username = "pinakasupport"
        pem_path = "/home/pinaka/.pinaka_wd/key/ps_key.pem"

        if not all([host, username, pem_path]):
            return jsonify({"error": "Missing remote credentials"}), 400

        return jsonify(*validate_remote(env_type, host, username, pem_path))
    else:
        return jsonify({"error": "Invalid mode (should be 'local' or 'remote')"}), 400


# ------------------------------------------------ Server Validation End --------------------------------------------

# ------------------------------------------------ local Interface list Start --------------------------------------------


@app.route("/get-interfaces", methods=["GET"])
def get_interfaces():
    # Initialize the interfaces list
    interfaces = []

    # Fetch network interface details
    net_info = psutil.net_if_addrs()

    # List of prefixes to exclude
    exclude_prefixes = (
        "docker",
        "lo",
        "ov",
        "br",
        "qg",
        "qr",
        "ta",
        "qv",
        "vxlan",
        "qbr",
        "qvo",
        "qvb",
        "q",
    )

    for iface, addrs in net_info.items():
        iface = (
            iface.strip().lower()
        )  # Strip spaces and convert to lowercase for case-insensitive comparison

        # Skip interfaces that start with any excluded prefix
        if iface.startswith(exclude_prefixes):
            continue

        mac = None
        ip = None
        is_physical = False

        # Check each address associated with the interface
        for addr in addrs:
            if addr.family.name == "AF_PACKET":  # MAC Address
                mac = addr.address
                is_physical = True  # Mark interface as physical if it has a MAC address
            elif addr.family.name == "AF_INET":  # IPv4 Address
                ip = addr.address

        # Only include physical interfaces (those with a MAC address)
        if (
            mac and is_physical
        ):  # Ensure that the interface is physical and has a MAC address
            interfaces.append({"iface": iface, "mac": mac, "ip": ip or "N/A"})

    # Fetch the number of CPU sockets (physical CPUs)
    cpu_sockets = get_cpu_socket_count()

    # Include the number of CPU sockets in the response
    response = {"interfaces": interfaces, "cpu_sockets": cpu_sockets}

    return jsonify(response)


# Function to get the CPU socket count
def get_cpu_socket_count():
    try:
        if os.path.exists("/proc/cpuinfo"):
            with open("/proc/cpuinfo", "r") as cpuinfo:
                sockets = set()
                for line in cpuinfo:
                    if line.startswith("physical id"):
                        sockets.add(line.split(":")[1].strip())
                return len(sockets)
        else:
            print("This script is designed to work on Linux systems.")
            return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None


# ------------------------------------------------ local Interface list End --------------------------------------------

# ------------------------------------------------ Encryption code run Start --------------------------------------------


# @app.route("/trigger-program", methods=["POST"])
def trigger_program():
    try:
        result = subprocess.run(
            ["python3", "encrypt.py"],
            check=True,
            capture_output=True,
            text=True
        )
        return {"success": True, "output": result.stdout}
    except subprocess.CalledProcessError as e:
        return {"success": False, "message": e.stderr}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ------------------------------------------------ Encryption code run End --------------------------------------------


# ------------------------------------------------ Validate License Start --------------------------------------------
# Function to decrypt a code (lookup MAC address, key, and key type)
def decrypt_code(code, lookup_table):
    return lookup_table.get(code, None)  # Return the entire record or None


# Load a JSON file and handle errors
def load_json_file(file_path):
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {file_path} file not found!")
    except json.JSONDecodeError:
        print(f"Error: Failed to decode {file_path}. Ensure it is a valid JSON.")
    return {}


# Check if the MAC address is available on the system
def is_mac_address_available(mac_address):
    try:
        result = subprocess.run(["ip", "link"], capture_output=True, text=True)
        return mac_address.lower() in result.stdout.lower()
    except Exception as e:
        print(f"Error checking MAC address: {e}")
        return False


# Function to remove specified files
def remove_files():
    files_to_remove = [
        "lookup_table.json",
        "perpetual_keys.json",
        "trial_keys.json",
        "yearly_keys.json",
        "triennial_keys.json",
    ]
    for file in files_to_remove:
        try:
            if os.path.exists(file):
                os.remove(file)
            # print(f"Removed: {file}")
            else:
                print(f"File not found: {file}")
        except Exception as e:
            print(f"Error removing file {file}: {e}")


# Function to export the license period based on the key type
def export_license_period(key_type):
    period = None
    if key_type == "trial":
        period = 15  # 15 days for trial
    elif key_type == "yearly":
        period = 365  # 365 days for yearly
    elif key_type == "triennial":
        period = 1095  # 1095 days for triennial
    elif key_type == "perpetual":
        period = "null"  # No export for perpetual, it's permanent

    return period


@app.route("/decrypt-code", methods=["POST"])
def decrypt_code_endpoint():

    encrypt_result = trigger_program()

    if not encrypt_result["success"]:
        return jsonify(encrypt_result), 500 
        
    data = request.get_json()

    if not data or "encrypted_code" not in data:
        return jsonify({"success": False, "message": "Encrypted code is required"}), 400

    encrypted_code = data["encrypted_code"]
    lookup_table = load_json_file("lookup_table.json")
    keys = load_json_file("key.json")

    # Get the CPU socket count
    socket_count_in = get_cpu_socket_count()
    if socket_count_in is None:
        return (
            jsonify(
                {"success": False, "message": "Unable to retrieve CPU socket count"}
            ),
            500,
        )

    # Attempt to decrypt the provided code
    decrypted_data = decrypt_code(encrypted_code, lookup_table)

    if decrypted_data is None:
        return (
            jsonify(
                {"success": False, "message": "Decryption failed, data mismatched!"}
            ),
            400,
        )

    mac_address = decrypted_data.get("mac_address")
    provided_key = decrypted_data.get("key")
    socket_count = decrypted_data.get("socket_count")
    license_type = decrypted_data.get(
        "licensePeriod"
    )  # Assuming `licensePeriod` contains the license type

    # Check if the MAC address is available on the system
    if not is_mac_address_available(mac_address):
        return (
            jsonify(
                {"success": False, "message": "MAC address not found on the system"}
            ),
            404,
        )

    if int(socket_count) != int(socket_count_in):
        return (
            jsonify({"success": False, "message": "Mismatching in Socket Count"}),
            400,
        )

    if not decrypted_data:
        return jsonify({"success": False, "message": "Code not found!"}), 404

    # Path to the license.txt file
    license_file_path = "/home/pinaka/Documents/GitHub/Pinaka-ZTi-v1.5/flask-back/license/license.txt"

    # Check if the license code already exists in the license.txt file
    if check_license_used(license_file_path, encrypted_code):
        return jsonify({"success": False, "message": "Code already used"}), 400

    # Verify the provided key against key.json and identify the key type
    key_type = next(
        (ktype for ktype, kvalue in keys.items() if kvalue == provided_key), None
    )

    if key_type:
        # Get the license period based on the key type
        license_period = export_license_period(key_type)

        remove_files()

        # Send response to frontend
        return jsonify(
            {
                "success": True,
                "mac_address": mac_address,
                "key_type": key_type,
                "license_period": license_period if license_period else "1",
                "socket_count": socket_count,
            }
        )
    else:
        return jsonify({"success": False, "message": "Invalid key provided"}), 404


# Helper function to check if the license code is already used
def check_license_used(file_path, license_code):
    try:
        if os.path.exists(file_path):
            with open(file_path, "r") as file:
                used_codes = file.readlines()
                return any(license_code.strip() == line.strip() for line in used_codes)
        return False
    except Exception as e:
        app.logger.error(f"Error checking license code in {file_path}: {e}")
        return False



# ------------------------------------------------ Validate License End --------------------------------------------


# ------------------------------------------------- Save and validate deploy config start----------------------------    
@app.route("/submit-network-config", methods=["POST"])
def submit_network_config():
    try:
        data = request.get_json(force=True)

        print("✅ Received data:", json.dumps(data, indent=2))

        table_data = data.get("tableData", [])
        config_type = data.get("configType", "default")
        use_bond = data.get("useBond", False)

        provider = data.get("providerNetwork", {})
        tenant = data.get("tenantNetwork", {})

        disk = data.get("disk", [])
        if not isinstance(disk, list):
            disk = [disk] if disk else []

        vip = data.get("vip", "")
        default_gateway = data.get("defaultGateway", "")

        # === Top-level validation ===
        if not table_data:
            app.logger.error(f"Missing tableData: {data}")
            return jsonify({"success": False, "message": "tableData is required"}), 400

        if config_type not in ["default", "segregated"]:
            app.logger.error(f"Invalid configType: {config_type}")
            return jsonify({"success": False, "message": "Invalid configType"}), 400

        # === Validate each row in tableData ===
        for i, row in enumerate(table_data):
            interface = row.get("interface")
            if not interface:
                app.logger.error(f"Missing 'interface' in row {i+1}: {row}")
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"'interface' is required in row {i+1}",
                        }
                    ),
                    400,
                )

            if isinstance(interface, str):
                interface = [interface]

            for iface in interface:
                if not iface.strip():
                    app.logger.error(f"Empty interface name in row {i+1}: {row}")
                    return (
                        jsonify(
                            {
                                "success": False,
                                "message": f"Blank interface in row {i+1}",
                            }
                        ),
                        400,
                    )

                # Check if the interface is up
                if not is_interface_up(iface):
                    app.logger.error(f"Interface {iface} is down.")
                    return (
                        jsonify(
                            {
                                "success": False,
                                "message": f"Network interface '{iface}' is down. Please bring it up",
                            }
                        ),
                        400,
                    )

            # Only check bond name if bonding is used
            if use_bond and "bondName" in row:
                if not row["bondName"]:
                    app.logger.error(f"Empty bondName in row {i+1}")
                    return (
                        jsonify(
                            {
                                "success": False,
                                "message": f"'bondName' cannot be empty in row {i+1}",
                            }
                        ),
                        400,
                    )

            # Only check VLAN ID if provided (optional, not required)
            if "vlanId" in row and row["vlanId"] != "":
                try:
                    int(row["vlanId"])
                except ValueError:
                    app.logger.error(f"Invalid VLAN ID in row {i+1}: {row['vlanId']}")
                    return (
                        jsonify(
                            {
                                "success": False,
                                "message": f"VLAN ID must be an integer in row {i+1}",
                            }
                        ),
                        400,
                    )
            if row.get("ip") and not is_network_available(row["ip"]):
                app.logger.error(f"Unreachable interface IP in row {i+1}: {row['ip']}")
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"Interface IP {row['ip']} in row {i+1} is unreachable or used by another device. Please check the network.",
                        }
                    ),
                    400,
                )


            if row.get("dns") and not is_ip_reachable(row["dns"]):
                app.logger.error(f"Unreachable DNS in row {i+1}: {row['dns']}")
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"DNS {row['dns']} in row {i+1} is unreachable (ping failed).",
                        }
                    ),
                    400,
                )

                # ✅ Validate VIP
        if vip:
            try:
                ipaddress.ip_address(vip)
            except ValueError:
                return jsonify({"success": False, "message": "Invalid VIP format"}), 400

            if not is_network_available(vip):
                return (
                    jsonify(
                        {"success": False, "message": "VIP network is not available or used by another device"}
                    ),
                    400,
                )

            if is_ip_reachable(vip) or is_ip_assigned(vip):
                return (
                    jsonify({"success": False, "message": "VIP is already in use"}),
                    400,
                )

        # === Build output JSON ===
        response_json = {
            "using_interfaces": {},
            "provider_cidr": provider.get("cidr", "N/A"),
            "provider_gateway": provider.get("gateway", "N/A"),
            "provider_startingip": provider.get("startingIp", "N/A"),
            "provider_endingip": provider.get("endingIp", "N/A"),
            "tenant_cidr": tenant.get("cidr", "10.0.0.0/24"),
            "tenant_gateway": tenant.get("gateway", "10.0.0.1"),
            "tenant_nameserver": tenant.get("nameserver", "8.8.8.8"),
            "disk": disk,
            "vip": vip,
            "default_gateway": default_gateway,  # Always include
            "hostname": data.get("hostname", "pinakasv"),  # Always include
            # Persist license details if provided by client
            "license_code": data.get("license_code"),
            "license_type": data.get("license_type"),
            "license_period": data.get("license_period"),
        }

        if default_gateway:
            if not is_ip_reachable(default_gateway):
                app.logger.error(
                    f"Default gateway {default_gateway} is not available on local network"
                )
                return (
                    jsonify(
                        {
                            "success": False,
                            "message": f"Default gateway {default_gateway} is not reachable from the host",
                        }
                    ),
                    400,
                )

        bond_count = 0
        iface_count = 1

        for row in table_data:
            row_type = row.get("type", [])
            if isinstance(row_type, str):
                row_type = [row_type]

            is_secondary = "Secondary" in row_type or row_type == ["secondary"]

            if use_bond and "bondName" in row and row["bondName"]:
                bond_key = f"bond{bond_count + 1}"
                response_json["using_interfaces"][bond_key] = {
                    "interface_name": row["bondName"],
                    "type": row_type,
                    "vlan_id": row.get("vlanId", "NULL") if row.get("vlanId") else "NULL",
                }

                if not is_secondary:
                    properties = {
                        "IP_ADDRESS": row.get("ip", ""),
                        "Netmask": row.get("subnet", ""),
                        "DNS": row.get("dns", ""),
                    }
                    # Add default gateway if this is the primary interface and gateway is provided
                    if default_gateway and not any(t in ["Secondary", "secondary"] for t in row_type):
                        properties["gateway"] = default_gateway
                    response_json["using_interfaces"][bond_key]["Properties"] = properties

                for iface in row.get("interface", []):
                    iface_key = f"interface_0{iface_count}"
                    response_json["using_interfaces"][iface_key] = {
                        "interface_name": iface,
                        "Bond_Slave": "YES",
                        "Bond_Interface_Name": row["bondName"],
                    }
                    iface_count += 1

                bond_count += 1

            else:
                iface_key = f"interface_0{iface_count}"
                interface_name = (
                    row["interface"][0]
                    if isinstance(row["interface"], list)
                    else row["interface"]
                )
                interface_entry = {
                    "interface_name": interface_name,
                    "type": row_type,
                    "vlan_id": row.get("vlanId", "NULL") if row.get("vlanId") else "NULL",
                    "Bond_Slave": "NO",
                }

                if not is_secondary or config_type == "segregated":
                    properties = {
                        "IP_ADDRESS": row.get("ip", ""),
                        "Netmask": row.get("subnet", ""),
                        "DNS": row.get("dns", ""),
                    }
                    # Add default gateway if this is the primary interface and gateway is provided
                    if default_gateway and (not is_secondary or config_type == "segregated"):
                        properties["gateway"] = default_gateway
                    interface_entry["Properties"] = properties

                response_json["using_interfaces"][iface_key] = interface_entry
                iface_count += 1

        # === Save the file ===
        config_dir = "/home/pinaka/Documents/GitHub/Pinaka-ZTi-v1.5/flask-back/submitted_configs/"
        os.makedirs(config_dir, exist_ok=True)
        file_path = os.path.join(config_dir, "data.json")
        
        try:
            with open(file_path, "w") as f:
                json.dump(response_json, f, indent=4)

            # Set appropriate permissions
            os.chmod(file_path, 0o644)  # rw-r--r--
            
            return jsonify({
                "success": True, 
                "message": "Network configuration saved successfully",
                "path": file_path
            }), 200
        except Exception as e:
            app.logger.error(f"❌ Failed to save network config: {str(e)}")
            return jsonify({
                "success": False, 
                "message": f"Failed to save configuration: {str(e)}"
            }), 500

    except Exception as e:
        app.logger.error(f"❌ Exception occurred: {str(e)}")
        return jsonify({"success": False, "message": f"Bad Request: {str(e)}"}), 400


def is_interface_up(interface):
    """Check if the given network interface is up. If not, attempt to bring it up."""
    try:
        result = subprocess.run(
            ["ip", "link", "show", interface],
            stdout=subprocess.PIPE,
            universal_newlines=True,
        )

        if "state UP" in result.stdout:
            return True  # Interface is already up

        print(f"Interface {interface} is down. Attempting to bring it up...")

        subprocess.run(["sudo", "ip", "link", "set", interface, "up"], check=False)
        subprocess.run(["sudo", "systemctl", "restart", "networking"], check=False)
        time.sleep(10)

        result = subprocess.run(
            ["ip", "link", "show", interface],
            stdout=subprocess.PIPE,
            universal_newlines=True,
        )
        if "state UP" in result.stdout:
            return True

        print(f"Retrying with ifconfig for {interface}...")
        subprocess.run(["sudo", "ifconfig", interface, "up"], check=False)
        subprocess.run(["sudo", "systemctl", "restart", "networking"], check=False)
        time.sleep(10)

        result = subprocess.run(
            ["ip", "link", "show", interface],
            stdout=subprocess.PIPE,
            universal_newlines=True,
        )
        if "state UP" in result.stdout:
            return True

        print(f"Error: Interface {interface} is still down after multiple attempts.")
        return False

    except Exception as e:
        print(f"Error checking interface {interface}: {e}")
        return False


@app.route('/is-vip-available', methods=['GET'])
def is_vip_available_api():
    vip = request.args.get('vip')
    if not vip:
        return jsonify({'success': False, 'error': 'VIP is required'}), 400

    try:
        ipaddress.ip_address(vip)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid VIP format"}), 400

    if not is_network_available(vip):
        return jsonify(
            {"success": False, "message": "VIP network is not available or used by another device"}
        ), 400

    if is_ip_reachable(vip) or is_ip_assigned(vip):
        return jsonify({"success": False, "message": "VIP is already in use"}), 400

    # If all checks pass
    return jsonify({"success": True, "message": "VIP is available"}), 200



def is_network_available(ip):
    try:
        subnet = ".".join(ip.split(".")[:3])
        interfaces = psutil.net_if_addrs()

        for interface, addresses in interfaces.items():
            for addr in addresses:
                if addr.family.name == "AF_INET":
                    local_ip = addr.address
                    local_subnet = ".".join(local_ip.split(".")[:3])
                    if local_ip == ip:
                        # It's the host's own IP, so it's fine
                        return True
                    if local_subnet == subnet:
                        # Same subnet, but not the same IP → we need to ping
                        result = subprocess.run(
                            ["ping", "-c", "1", "-W", "1", ip],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL
                        )
                        return result.returncode != 0  # True if IP is not reachable (i.e., available)
        
        # If no local interface in subnet
        print(f"Error: No network interface available in the subnet {subnet}.")
        return False

    except Exception as e:
        print(f"Error checking network availability: {e}")
        return False


def is_ip_reachable(dns_ip, count=1, timeout=2):
    """
    Ping a DNS server IP to check if it's reachable.

    Args:
        dns_ip (str): The DNS IP address to check.
        count (int): Number of ping packets to send.
        timeout (int): Timeout per ping attempt in seconds.

    Returns:
        bool: True if reachable, False otherwise.
    """
    try:
        result = subprocess.run(
            ["ping", "-c", str(count), "-W", str(timeout), dns_ip],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Error pinging DNS {dns_ip}: {e}")
        return False


def is_ip_assigned(ip):
    try:
        interfaces = psutil.net_if_addrs()
        for interface in interfaces.values():
            for addr in interface:
                if addr.family.name == "AF_INET" and addr.address == ip:
                    return True
        return False
    except Exception as e:
        print(f"Error checking if IP is assigned: {e}")
        return False


# ------------------------------------------------- Save and validate deploy config end----------------------------


# ------------------------------------------------GET DISK LIST FROM THE RUNNING SERVER Start-----------------------


def get_root_disk():
    """Find the root disk name."""
    try:
        result = subprocess.run(
            ["lsblk", "-o", "NAME,MOUNTPOINT", "-J"], capture_output=True, text=True
        )
        data = json.loads(result.stdout)

        for disk in data.get("blockdevices", []):
            if "children" in disk:
                for part in disk["children"]:
                    if part.get("mountpoint") == "/":
                        return disk["name"]  # Root disk name (e.g., "sda")

        return None  # Return None if no root disk is found
    except Exception as e:
        return None


def get_disk_list():
    """Fetch disk list using lsblk and exclude the root disk."""
    try:
        # Get disk details including WWN
        result = subprocess.run(
            ["lsblk", "-o", "NAME,SIZE,WWN", "-J"], capture_output=True, text=True
        )
        disks = json.loads(result.stdout).get("blockdevices", [])

        # Get the root disk name
        root_disk = get_root_disk()

        # Filter out small-sized disks (KB, MB) and the root disk
        small_size_pattern = re.compile(r"\b(\d+(\.\d+)?)\s*(K|M)\b", re.IGNORECASE)
        filtered_disks = [
            {
                "name": disk["name"],
                "size": disk["size"],
                "wwn": disk.get("wwn", "N/A"),  # Some disks may not have WWN
            }
            for disk in disks
            if not small_size_pattern.search(disk["size"]) and disk["name"] != root_disk
        ]

        return filtered_disks
    except Exception as e:
        return str(e)


@app.route("/get-disks", methods=["GET"])
def get_disks():
    """API endpoint to get the list of available disks."""
    disks = get_disk_list()
    return jsonify({"disks": disks, "status": "success"})


# ------------------------------------------------GET DISK LIST FROM THE RUNNING SERVER End-----------------------


# ------------------- System Utilization Endpoint -------------------
import psutil

@app.route('/system-utilization', methods=['GET'])
def system_utilization():
    try:
        cpu_percent = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory()
        mem_percent = mem.percent
        total_mem_mb = int(mem.total / (1024*1024))
        used_mem_mb = int(mem.used / (1024*1024))
        # Add to history buffers
        add_cpu_history(cpu_percent)
        add_memory_history(mem_percent)
        return jsonify({
            "cpu": cpu_percent,
            "memory": mem_percent,
            "total_memory": total_mem_mb,
            "used_memory": used_mem_mb
        })
    except Exception as e:
        # Always return all keys with safe values, plus error for debugging
        return jsonify({
            "cpu": 0,
            "memory": 0,
            "total_memory": 0,
            "used_memory": 0,
            "error": str(e)
        }), 200

@app.route('/system-utilization-history', methods=['GET'])
def system_utilization_history():
    try:
        cpu_history = get_cpu_history()
        memory_history = get_memory_history()
        return jsonify({
            "cpu_history": cpu_history,
            "memory_history": memory_history
        })
    except Exception as e:
        return jsonify({
            "cpu_history": [],
            "memory_history": [],
            "error": str(e)
        })

def get_available_interfaces():
    try:
        with open('/proc/net/dev', 'r') as f:
            lines = f.readlines()[2:]  # Skip headers
            interfaces = [line.strip().split(':')[0].strip() for line in lines]
            return interfaces
    except Exception:
        return []

def get_bandwidth(interface):
    try:
        with open('/proc/net/dev', 'r') as f:
            lines = f.readlines()
        for line in lines:
            if interface in line:
                data = line.split()
                rx_bytes = int(data[1])
                tx_bytes = int(data[9])
                return rx_bytes, tx_bytes
        return None, None
    except Exception:
        return None, None

def get_latency(host="8.8.8.8", count=3):
    try:
        output = subprocess.check_output(["ping", "-c", str(count), host], stderr=subprocess.DEVNULL).decode()
        match = re.search(r"min/avg/max/mdev = [\d\.]+/([\d\.]+)/", output)
        if match:
            return float(match.group(1))
    except Exception:
        pass
    return None

@app.route("/interfaces", methods=["GET"])
def interfaces():
    iface_list = get_available_interfaces()
    return jsonify([{"label": iface, "value": iface} for iface in iface_list])

@app.route("/network-health", methods=["GET"])
def network_health():
    interfaces = get_available_interfaces()
    interface = request.args.get("interface")
    
    if not interface:
        if interfaces:
            interface = interfaces[0]
        else:
            return jsonify({"error": "No network interfaces available"}), 500

    ping_host = request.args.get("ping_host", "8.8.8.8")

    rx1, tx1 = get_bandwidth(interface)
    time.sleep(1)
    rx2, tx2 = get_bandwidth(interface)

    if None in (rx1, tx1, rx2, tx2):
        return jsonify({"error": f"Failed to read bandwidth data for interface {interface}"}), 500

    bandwidth_rx_kbps = (rx2 - rx1) / 1024
    bandwidth_tx_kbps = (tx2 - tx1) / 1024
    latency_ms = get_latency(ping_host)

    # Add to bandwidth history
    add_bandwidth_history(interface)

    return jsonify({
        "time": time.strftime("%H:%M"),
        "bandwidth_kbps": round(bandwidth_rx_kbps + bandwidth_tx_kbps, 2),
        "latency_ms": round(latency_ms, 2) if latency_ms is not None else None
    })

# Bandwidth history endpoint
@app.route('/bandwidth-history', methods=['GET'])
def bandwidth_history():
    interface = request.args.get('interface')
    if not interface:
        interfaces = get_available_interfaces()
        if interfaces:
            interface = interfaces[0]
        else:
            return jsonify({"bandwidth_history": [], "error": "No interfaces available"})
    # Optionally, trigger a new sample
    add_bandwidth_history(interface)
    return jsonify({"bandwidth_history": get_bandwidth_history()})

# Thresholds for health levels
CPU_WARNING = 80
CPU_CRITICAL = 90
MEM_WARNING = 70
MEM_CRITICAL = 85
DISK_WARNING = 80
DISK_CRITICAL = 90

def get_local_health_status():
    try:
        # CPU usage (average over 1 second)
        cpu_usage = psutil.cpu_percent(interval=1)

        # Memory usage
        mem = psutil.virtual_memory()
        mem_usage = mem.percent

        # Disk usage
        disk = psutil.disk_usage('/')
        disk_usage = disk.percent

        # Determine status
        status = "Good"
        if cpu_usage > CPU_CRITICAL or mem_usage > MEM_CRITICAL or disk_usage > DISK_CRITICAL:
            status = "Critical"
        elif cpu_usage > CPU_WARNING or mem_usage > MEM_WARNING or disk_usage > DISK_WARNING:
            status = "Warning"

        # Build reasons per metric
        reasons = []
        if cpu_usage > CPU_CRITICAL:
            reasons.append({"metric": "CPU", "level": "CRITICAL", "actual": round(cpu_usage, 2), "threshold": CPU_CRITICAL})
        elif cpu_usage > CPU_WARNING:
            reasons.append({"metric": "CPU", "level": "WARNING", "actual": round(cpu_usage, 2), "threshold": CPU_WARNING})

        if mem_usage > MEM_CRITICAL:
            reasons.append({"metric": "Memory", "level": "CRITICAL", "actual": round(mem_usage, 2), "threshold": MEM_CRITICAL})
        elif mem_usage > MEM_WARNING:
            reasons.append({"metric": "Memory", "level": "WARNING", "actual": round(mem_usage, 2), "threshold": MEM_WARNING})

        if disk_usage > DISK_CRITICAL:
            reasons.append({"metric": "Disk", "level": "CRITICAL", "actual": round(disk_usage, 2), "threshold": DISK_CRITICAL})
        elif disk_usage > DISK_WARNING:
            reasons.append({"metric": "Disk", "level": "WARNING", "actual": round(disk_usage, 2), "threshold": DISK_WARNING})

        return {
            "status": status,
            "metrics": {
                "cpu_usage_percent": round(cpu_usage, 2),
                "memory_usage_percent": round(mem_usage, 2),
                "disk_usage_percent": round(disk_usage, 2)
            },
            "thresholds": {
                "cpu": {"warning": CPU_WARNING, "critical": CPU_CRITICAL},
                "memory": {"warning": MEM_WARNING, "critical": MEM_CRITICAL},
                "disk": {"warning": DISK_WARNING, "critical": DISK_CRITICAL}
            },
            "reasons": reasons
        }

    except Exception as e:
        return {"status": "Error", "message": str(e)}

@app.route('/check-health', methods=['GET'])
def check_health():
    result = get_local_health_status()
    return jsonify(result)

@app.route('/docker-info', methods=['GET'])
def docker_info():
    result = get_docker_info()
    return jsonify(result)

def get_docker_info():
    containers = []
    up_count = 0
    down_count = 0
    try:
        # Get all containers (id, name, status)
        cmd = [
            'docker', 'ps', '-a', '--format', '{{.ID}}||{{.Names}}||{{.Status}}'
        ]
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode('utf-8')
        for line in output.strip().split('\n'):
            if not line.strip():
                continue
            parts = line.split('||')
            if len(parts) != 3:
                continue
            docker_id, container_name, status_text = parts
            # Consider "UP" if status starts with "Up", else "DOWN"
            status = 'UP' if status_text.strip().lower().startswith('up') else 'DOWN'
            if status == 'UP':
                up_count += 1
            else:
                down_count += 1
            containers.append({
                'dockerId': docker_id,
                'containerName': container_name,
                'status': status
            })
        return {
            'containers': containers,
            'total': len(containers),
            'up': up_count,
            'down': down_count
        }
    except Exception as e:
        return {
            'containers': [],
            'total': 0,
            'up': 0,
            'down': 0,
            'error': str(e)
        }

@app.route('/node-status', methods=['GET'])
def node_status():
    ip = request.args.get('ip')
    if not ip:
        return jsonify({'status': 'DOWN', 'error': 'No IP provided'}), 400
    result = get_node_status(ip)
    return jsonify(result)

def get_node_status(ip):
    print(f"Checking status for IP: {ip}")
    
    # Check if IP is a local address
    try:
        local_ips = []
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                for a in addrs[netifaces.AF_INET]:
                    if 'addr' in a:
                        local_ips.append(a['addr'])
        local_ips.extend(['127.0.0.1', 'localhost'])
        if ip in local_ips:
            print(f"IP {ip} is local, marking as UP")
            return {'status': 'UP'}
    except Exception as e:
        print(f"Error checking local IPs: {str(e)}")
    
    # Use the specified PEM key path
    pem_key = "/home/pinaka/.pinaka_wd/key/ps_key.pem"
    print(f"Using PEM key: {pem_key}")
    
    if not os.path.exists(pem_key):
        error_msg = f'PEM key not found at {pem_key}'
        print(error_msg)
        return {'status': 'DOWN', 'error': error_msg}
    
    username = 'pinakasupport'  # specified username
    print(f"Attempting SSH connection to {username}@{ip}")
    
    try:
        # Test if we can read the key file
        try:
            k = paramiko.RSAKey.from_private_key_file(pem_key)
            print("Successfully loaded private key")
        except Exception as e:
            error_msg = f'Failed to load private key: {str(e)}'
            print(error_msg)
            return {'status': 'DOWN', 'error': error_msg}
        
        # Attempt SSH connection
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            print(f"Attempting to connect to {ip}...")
            ssh.connect(ip, username=username, pkey=k, timeout=5, banner_timeout=10, auth_timeout=10)
            print("SSH connection successful")
            
            # Test if we can execute a simple command
            try:
                stdin, stdout, stderr = ssh.exec_command('echo "Connection test successful"', timeout=5)
                exit_status = stdout.channel.recv_exit_status()
                if exit_status == 0:
                    print("Command execution test passed")
                else:
                    error_msg = f'Command failed with exit status {exit_status}'
                    print(error_msg)
                    return {'status': 'DOWN', 'error': error_msg}
            except Exception as e:
                error_msg = f'Command execution test failed: {str(e)}'
                print(error_msg)
                return {'status': 'DOWN', 'error': error_msg}
            
            return {'status': 'UP'}
            
        except Exception as e:
            error_msg = f'SSH connection failed: {str(e)}'
            print(error_msg)
            return {'status': 'DOWN', 'error': error_msg}
            
        finally:
            try:
                ssh.close()
                print("SSH connection closed")
            except:
                pass
                
    except Exception as e:
        error_msg = f'Unexpected error: {str(e)}'
        print(error_msg)
        return {'status': 'DOWN', 'error': error_msg}

# ------------------- System Utilization Endpoint ends -------------------

# ------------------- Scan Network Endpoint starts-------------------

# Function to get the local network IP
def get_local_network_ip():
    interfaces = netifaces.interfaces()
    for interface in interfaces:
        addresses = netifaces.ifaddresses(interface)
        if netifaces.AF_INET in addresses:  # Check if the interface has an IPv4 address
            for link in addresses[netifaces.AF_INET]:
                if 'addr' in link and not link['addr'].startswith('127.'):
                    return link['addr']
    return None  # Return None if no suitable IP address is found

# Function to get the network range (CIDR)
def get_network_range(local_ip):
    ip_interface = ipaddress.IPv4Interface(local_ip + '/24')  # Assuming /24 subnet
    network = ip_interface.network
    return network

# Function to scan the network (ARP scan)
def scan_network(network):
    arp_request = ARP(pdst=str(network))
    broadcast = Ether(dst="ff:ff:ff:ff:ff:ff")
    arp_request_broadcast = broadcast / arp_request
    answered_list = srp(arp_request_broadcast, timeout=5, retry=3, verbose=False)[0]  # Increased timeout and retries

    active_nodes = []
    for sent, received in answered_list:
        node_info = {
            'ip': received.psrc,
            'mac': received.hwsrc,
            'last_seen': datetime.now().strftime('%Y-%m-%d')
        }
        active_nodes.append(node_info)

    return active_nodes

@app.route('/scan', methods=['GET'])
def scan_network_api():
    logging.info("Received scan request")

    # Check if a subnet is provided in the query parameters
    subnet = request.args.get('subnet')
    local_ip = get_local_network_ip()  # Ensure the local IP is retrieved before using it
    
    if not local_ip:
        logging.error("Failed to retrieve local network IP address.")
        return jsonify({"error": "Failed to retrieve local network IP address."}), 500

    if subnet:
        try:
            # Validate and parse the subnet
            network = ipaddress.IPv4Network(subnet, strict=False)
            logging.info(f"Scanning provided subnet: {network}")
        except ValueError:
            logging.error("Invalid subnet format provided.")
            return jsonify({"error": "Invalid subnet format."}), 400
    else:
        # Use the local network IP if no subnet is provided
        network = get_network_range(local_ip)
        logging.info(f"Scanning local network: {network}")
    
    # Perform the scan
    active_nodes = scan_network(network)
    logging.info(f"Scan completed. Found {len(active_nodes)} active nodes.")

    # Return the results
    return jsonify({
        "active_nodes": active_nodes,
        "subnet": str(network),
        "local_ip": local_ip
    })

# ------------------- Scan Network Endpoint ends -------------------


# ------------------- Server Control Endpoint starts -------------------

@app.route('/server-control', methods=['POST'])
def server_control():
    data = request.get_json()
    server_ip = data.get('server_ip')
    action = data.get('action')  # 'status', 'shutdown', or 'reboot'
    
    if not server_ip:
        return jsonify({'error': 'Server IP is required'}), 400
    
    if not action:
        return jsonify({'error': 'Action is required'}), 400
    
    if action not in ['status', 'shutdown', 'reboot']:
        return jsonify({'error': 'Invalid action. Must be one of: status, shutdown, reboot'}), 400
    
    try:
        # Setup SSH client
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        # Load the private key
        key_path = '/home/pinaka/.pinaka_wd/key/ps_key.pem'
        if not os.path.exists(key_path):
            return jsonify({'error': f'Key file {key_path} not found'}), 500
            
        key = paramiko.RSAKey.from_private_key_file(key_path)
        
        # Try to connect with timeout
        try:
            ssh.connect(hostname=server_ip, username='pinakasupport', pkey=key, timeout=5)
            
            # Handle different actions
            if action == 'status':
                ssh.close()
                return jsonify({'status': 'online'})
            elif action == 'shutdown':
                stdin, stdout, stderr = ssh.exec_command('sudo shutdown -h now')
                ssh.close()
                return jsonify({'success': True, 'message': 'Shutdown command sent successfully'})
            elif action == 'reboot':
                stdin, stdout, stderr = ssh.exec_command('sudo reboot')
                ssh.close()
                return jsonify({'success': True, 'message': 'Reboot command sent successfully'})
        except Exception as e:
            # If connection fails, handle based on action
            if action == 'status':
                return jsonify({'status': 'offline', 'error': str(e)})
            else:
                return jsonify({'success': False, 'error': str(e)})
    
    except Exception as e:
        error_message = f'Error executing {action}: {str(e)}'
        return jsonify({'error': error_message}), 500

# ------------------- Server Control Endpoint ends -------------------

# Keep these routes for backward compatibility
@app.route('/check-server-status', methods=['POST'])
def check_server_status():
    data = request.get_json()
    data['action'] = 'status'
    return server_control()

@app.route('/server-shutdown', methods=['POST'])
def server_shutdown():
    data = request.get_json()
    data['action'] = 'shutdown'
    return server_control()

@app.route('/server-reboot', methods=['POST'])
def server_reboot():
    data = request.get_json()
    data['action'] = 'reboot'
    return server_control()

# ------------------- Server Power Control Endpoints end -------------------

# ------------------- Store Deployment Configs Endpoint -------------------

@app.route('/store-deployment-configs', methods=['POST'])
def store_deployment_configs():
    data = request.get_json()
    if not data or not isinstance(data, (list, dict)):
        return jsonify({'error': 'Invalid data format'}), 400

    # Accept both list and dict (dict: {ip: config, ...})
    if isinstance(data, dict):
        node_items = list(data.items())
    else:
        # If list, expect each item to have a unique 'ip' or 'hostname'
        node_items = [(str(i+1), node) for i, node in enumerate(data)]

    # Directory to store configs (must match node_deployment_progress)
    configs_dir = pathlib.Path('/home/pinaka/.pinaka_wd/cluster/nodes/')
    configs_dir.mkdir(exist_ok=True)
    results = []
    for idx, (node_key, node_cfg) in enumerate(node_items, 1):
        fname = f"node_{idx:02d}.json"
        fpath = configs_dir / fname
        try:
            with open(fpath, 'w') as f:
                json.dump(node_cfg, f, indent=2)
            results.append({'node': node_key, 'file': str(fpath), 'status': 'success'})
        except Exception as e:
            results.append({'node': node_key, 'file': str(fpath), 'status': 'error', 'error': str(e)})
    return jsonify({'results': results, 'success': all(r['status']== 'success' for r in results)})

# -------------------------------------------------------------------------

from flask import Response
import threading
import queue


@app.route('/poll-ssh-status', methods=['POST'])
def poll_ssh_status():
    """
    POST /poll-ssh-status
    Start SSH polling for the provided IPs
    """
    print(f"DEBUG: poll-ssh-status endpoint called")
    data = request.get_json()
    print(f"DEBUG: Received data: {data}")

    # Accept list of IPs from frontend (required)
    ips = data.get('ips')
    if not ips or not isinstance(ips, list) or not all(isinstance(ip, str) for ip in ips):
        print(f"DEBUG: Invalid IPs data: {ips}")
        return Response('Missing or invalid "ips" in request body', status=400)
    
    # Force PEM-only auth with fixed user, ignore client-provided credentials
    ssh_user = 'pinakasupport'
    ssh_pass = None
    ssh_key = None
    print(f"DEBUG: Enforcing PEM-only auth. Using user '{ssh_user}', no password, no inline key (disk PEM only)")
    
    pem_path = "/home/pinaka/.pinaka_wd/key/ps_key.pem"

    import threading, queue, time, json
    status_queue = queue.Queue()
    stop_flags = {ip: threading.Event() for ip in ips}
    results = {ip: False for ip in ips}

    def try_ssh(ip):
        print(f"DEBUG: Attempting SSH connection to {ip}")
        print(f"DEBUG: SSH User: {ssh_user}")
        print(f"DEBUG: SSH Password provided: {'Yes' if ssh_pass else 'No'} (ignored)")
        print(f"DEBUG: SSH Key provided: {'Yes' if ssh_key else 'No'}")
        
        try:
            # Quick TCP reachability check on port 22
            try:
                with socket.create_connection((ip, 22), timeout=5) as s:
                    pass
                print(f"DEBUG: TCP port 22 reachable on {ip}")
            except Exception as sock_err:
                print(f"DEBUG: TCP port 22 NOT reachable on {ip}: {sock_err}")
                return False, f"TCP 22 unreachable: {sock_err}"

            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            pkey = None
            
            # Try to use provided SSH key material first
            if ssh_key:
                try:
                    import io
                    pkey = paramiko.RSAKey.from_private_key(io.StringIO(ssh_key))
                    print(f"DEBUG: Using provided SSH key material for {ip}")
                except Exception as e:
                    print(f"DEBUG: Failed to load provided SSH key: {e}")
                    pkey = None
            
            # If no inline key, use the fixed PEM file path provided
            if not pkey:
                try:
                    selected_path = "/home/pinaka/Documents/GitHub/Pinaka-ZTi-v1.5/flask-back/ps_key.pem"
                    if not os.path.exists(selected_path):
                        raise FileNotFoundError(f"PEM key file not found at: {selected_path}")
                    pkey = paramiko.RSAKey.from_private_key_file(selected_path)
                    print(f"DEBUG: Using SSH key file: {selected_path} for {ip}")
                except Exception as e:
                    print(f"DEBUG: Failed to load SSH key file: {e}")
                    return False, f"SSH key error: {e}"
            
            # Connect strictly with key (no password)
            print(f"DEBUG: Connecting with SSH key to {ip}")
            ssh.connect(
                ip,
                username=ssh_user,
                pkey=pkey,
                timeout=10,
                banner_timeout=60,
                auth_timeout=30,
                look_for_keys=False,
                allow_agent=False,
            )
            ssh.close()
            print(f"DEBUG: SSH connection successful to {ip}")
            return True, None
        except Exception as e:
            error_msg = str(e)
            print(f"DEBUG: SSH connection failed to {ip}: {error_msg}")
            return False, error_msg

    def poll_ip(ip):
        print(f"DEBUG: Starting SSH polling for IP: {ip}")
        while not stop_flags[ip].is_set():
            ok, err = try_ssh(ip)
            print(f"DEBUG: SSH attempt for {ip}: {'SUCCESS' if ok else f'FAILED - {err}'}")
            if ok:
                # Store success result in global variable
                ssh_polling_results[ip] = {"status": "success", "ip": ip, "message": f"SSH successful to {ip}"}
                results[ip] = True
                stop_flags[ip].set()
                print(f"DEBUG: SSH SUCCESS for {ip}, stored result")
                break
            else:
                # Store fail result temporarily (will be overwritten by next attempt)
                ssh_polling_results[ip] = {"status": "fail", "ip": ip, "message": f"SSH failed to {ip}: {err}"}
                print(f"DEBUG: SSH FAIL for {ip}, stored fail result")
            time.sleep(5)

    # Start polling threads after 90 seconds
    def start_polling():
        print(f"DEBUG: Starting 90-second delay for SSH polling")
        time.sleep(90)  # Wait 1 minute 30 seconds
        print(f"DEBUG: 90-second delay completed, starting SSH polling for IPs: {ips}")
        threads = []
        for ip in ips:
            t = threading.Thread(target=poll_ip, args=(ip,), daemon=True)
            t.start()
            threads.append(t)
        
        # Wait for all threads to complete
        for t in threads:
            t.join()
    
    # Start the polling in a separate thread
    polling_thread = threading.Thread(target=start_polling, daemon=True)
    polling_thread.start()
    
    return jsonify({"success": True, "message": f"SSH polling started for {len(ips)} IP(s). Will begin after 90 seconds."})

# Global storage for SSH polling results
ssh_polling_results = {}

@app.route('/check-ssh-status', methods=['GET'])
def check_ssh_status():
    """
    GET /check-ssh-status?ip=1.2.3.4
    Returns the current SSH status for a specific IP
    """
    ip = request.args.get('ip')
    if not ip:
        return jsonify({'error': 'Missing IP parameter'}), 400
    
    # Debug logging
    print(f"DEBUG: Checking SSH status for IP: {ip}")
    print(f"DEBUG: ssh_polling_results keys: {list(ssh_polling_results.keys())}")
    
    # Check if we have a result for this IP
    if ip in ssh_polling_results:
        result = ssh_polling_results[ip]
        # Remove the result after returning it (one-time use)
        del ssh_polling_results[ip]
        print(f"DEBUG: Returning result for {ip}: {result}")
        return jsonify(result)
    
    # If no result yet, return fail status
    print(f"DEBUG: No result found for {ip}, returning fail status")
    return jsonify({
        'status': 'fail',
        'ip': ip,
        'message': 'SSH polling in progress'
    })

@app.route('/node-deployment-progress', methods=['GET'])
def node_deployment_progress():
    try:
        configs_dir = pathlib.Path('/home/pinaka/.pinaka_wd/cluster/nodes/')
        if not configs_dir.exists():
            # No folder means no pending node_* files → consider completed
            return jsonify({
                'in_progress': False,
                'files': []
            })
        node_files = sorted([p.name for p in configs_dir.glob('node_*') if p.is_file()])
        in_progress = len(node_files) > 0
        return jsonify({
            'in_progress': in_progress,
            'files': node_files
        })
    except Exception as e:
        # On error, default to not in progress but include the error for visibility
        return jsonify({
            'in_progress': False,
            'error': str(e)
        })

#--------------------------------------------License Update Start------------------------------------------------

@app.route("/apply-license", methods=["POST"])
def apply_license():
    """
    Accepts license details and SSHes to the target server to persist them.
    This endpoint ONLY performs the SSH write; DB updates are handled by the frontend.
    If SSH write fails, returns error.

    Expected JSON:
    {
      server_ip,
      license_code, license_type, license_period,
      ssh_username? (default: pinakasupport),
      ssh_key_path? (default: /home/pinaka/ps_key.pem),
      remote_path? (default: /opt/pinaka/license/license.json)
    }
    """
    try:
        data = request.get_json(force=True) or {}

        server_ip = data.get("server_ip")
        license_code = data.get("license_code")
        license_type = data.get("license_type")
        license_period = data.get("license_period")

        ssh_username = data.get("ssh_username", "pinakasupport")
        ssh_key_path = data.get("ssh_key_path", "/home/pinaka/.pinaka_wd/key/ps_key.pem")
        remote_path = data.get("remote_path", "/home/pinaka/.pinaka_wd/license/license.json")

        missing = [k for k, v in {
            "server_ip": server_ip,
            "license_code": license_code,
            "license_type": license_type,
            "license_period": license_period,
        }.items() if not v and v != 0]
        if missing:
            return jsonify({"success": False, "message": f"Missing required fields: {', '.join(missing)}"}), 400

        # 1) SSH to target and store license file
        try:
            key = paramiko.RSAKey.from_private_key_file(ssh_key_path)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(hostname=server_ip, username=ssh_username, pkey=key, timeout=30)

            remote_dir = os.path.dirname(remote_path)
            # Ensure directory exists and is writable
            stdin, stdout, stderr = ssh.exec_command(f"sudo mkdir -p {remote_dir}")
            exit_code = stdout.channel.recv_exit_status()
            if exit_code != 0:
                raise RuntimeError(f"mkdir failed: {stderr.read().decode().strip()}")

            sftp = ssh.open_sftp()
            tmp_path = f"/tmp/license-{int(time.time())}.json"
            payload = {
                "license_code": license_code,
                "license_type": license_type,
                "license_period": license_period,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            }
            data_bytes = json.dumps(payload, indent=2).encode("utf-8")
            f = sftp.file(tmp_path, "w")
            f.write(data_bytes)
            f.flush()
            f.close()
            sftp.chmod(tmp_path, 0o644)
            # Move into place atomically (may require sudo)
            stdin, stdout, stderr = ssh.exec_command(
                f"sudo mv {tmp_path} {remote_path} && sudo chmod 644 {remote_path}"
            )
            exit_code = stdout.channel.recv_exit_status()
            if exit_code != 0:
                raise RuntimeError(f"move/chmod failed: {stderr.read().decode().strip()}")
            sftp.close()
            ssh.close()
        except Exception as e:
            return jsonify({
                "success": False,
                "message": f"Failed to store license on server {server_ip}: {str(e)}"
            }), 500
        # DB update is handled by the frontend after a successful SSH apply.

        return jsonify({
            "success": True,
            "message": "License stored on server"
        }), 200

    except Exception as e:
        return jsonify({"success": False, "message": f"Bad Request: {str(e)}"}), 400

#--------------------------------------------License Update End--------------------------------------------------

#--------------------------------------------Openstack Operation Start-------------------------------------------
@app.route("/resource-usage", methods=["GET"])
def get_resource_usage():
    os.environ["OS_CLIENT_CONFIG_FILE"] = "/etc/kolla/clouds.yaml"
    conn = openstack.connect(cloud='kolla-admin')

    CPU_ALLOCATION_RATIO = 4.0

    try:
        # --- Instances (all projects) ---
        instances = list(conn.compute.servers(all_projects=True))
        instance_count = len(instances)

        # --- vCPU & Memory Usage (aggregate stats across hypervisors) ---
        stats = conn.compute.get("/os-hypervisors/statistics").json()["hypervisor_statistics"]

        physical_vcpus = stats.get("vcpus", 0)
        used_vcpus = stats.get("vcpus_used", 0)

        # Apply allocation ratio
        total_vcpus = int(physical_vcpus * CPU_ALLOCATION_RATIO)

        total_memory = stats.get("memory_mb", 0)   # MB
        used_memory = stats.get("memory_mb_used", 0)

        total_memory_gib = round(total_memory / 1024, 2)
        used_memory_gib = round(used_memory / 1024, 2)

        # --- Volumes (all projects) ---
        volumes = list(conn.block_storage.volumes(details=True, all_projects=True))
        volumes_in_use = sum(1 for v in volumes if v.status == "in-use")

        # Response
        data = {
            "instances": instance_count,
            "vcpu": {
                "used": used_vcpus,       # leave usage raw
                "total": total_vcpus      # scaled with allocation ratio
            },
            "memory": {
                "used": used_memory_gib,
                "total": total_memory_gib
            },
            "volumes_in_use": volumes_in_use
        }

        return jsonify(data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def load_openstack_env():
    """Loads OpenStack environment variables and returns them as a dictionary."""
    env_cmd = "source /home/pinakasupport/.pinaka_wd/vpinakastra_pd/bin/activate && source /etc/kolla/admin-openrc.sh && env"

    result = subprocess.run(
        env_cmd, shell=True, capture_output=True, text=True, executable="/bin/bash"
    )
    if result.returncode != 0:
        print("Failed to load OpenStack environment:", result.stderr)
        return None

    env_vars = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            env_vars[key] = value

    return env_vars


def run_openstack_command(command, env_vars):
    """Runs an OpenStack CLI command with JSON output."""
    try:
        output = subprocess.check_output(
            command, shell=True, text=True, executable="/bin/bash", env=env_vars
        )
        return json.loads(output)  # Convert JSON string to Python dictionary
    except subprocess.CalledProcessError as e:
        return {"error": e.output}


@app.route("/api/openstack_data")
def get_openstack_data():
    env_vars = load_openstack_env()
    if env_vars is None:
        return jsonify({"error": "Failed to load OpenStack environment"}), 500

    compute_services = run_openstack_command(
        "openstack compute service list -f json", env_vars
    )
    network_agents = run_openstack_command(
        "openstack network agent list -f json", env_vars
    )
    volume_services = run_openstack_command(
        "openstack volume service list -f json", env_vars
    )

    return jsonify(
        {
            "compute_services": compute_services,
            "network_agents": network_agents,
            "volume_services": volume_services,
        }
    )


@app.route("/ceph/osd-count", methods=["GET"])
def get_osd_count():
    try:
        # Read Ceph credentials file
        cred_file = os.path.expanduser("/home/pinaka/.pinaka_wd/.markers/ceph_dashboard_credentials.txt")
        with open(cred_file, "r") as f:
            content = f.read()

        # Extract hostname from the Dashboard URL line
        match = re.search(r"https://([^:]+):\d+", content)
        if not match:
            return jsonify({"error": "Could not parse hostname from credentials file"}), 500
        hostname = match.group(1)

        # SSH credentials (assuming same user running Flask, adjust as needed)
        ssh_user = "pinakasupport"   # or pinakasupport if Ceph is managed under that user
        ssh_key = os.path.expanduser("~/.ssh/id_rsa")  # or password if required

        # Connect to remote Ceph node
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(hostname, username=ssh_user, key_filename=ssh_key)

        # Run the Ceph command remotely
        cmd = "cephadm shell -- ceph osd stat --format json"
        stdin, stdout, stderr = ssh.exec_command(cmd)

        result = stdout.read().decode().strip()
        err = stderr.read().decode().strip()

        ssh.close()

        if err:
            return jsonify({"error": err}), 500

        # Parse JSON output
        osd_stat = json.loads(result)

        data = {
            "total_osds": osd_stat.get("num_osds", 0),
            "up_osds": osd_stat.get("num_up_osds", 0),
            "in_osds": osd_stat.get("num_in_osds", 0)
        }

        return jsonify(data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500



# ----- Paths & env -----
WORK_DIR = "/home/pinakasupport/.pinaka_wd/vpinakastra/"
LOG_DIR = "/home/pinakasupport/.pinaka_wd/logs/"
LOG_FILE = os.path.join(LOG_DIR, "kolla_command.log")

# Common environment sourcing (virtualenv + OpenStack)
# NOTE: we append 'env' to ensure proper env vars are exported to the shell session.
ENV_CMD = (
    "source /home/pinakasupport/.pinaka_wd/vpinakastra/bin/activate && "
    "source /etc/kolla/admin-openrc.sh && env"
)

INVENTORY = "multinode"  # change if you use another inventory file


def ensure_paths():
    os.makedirs(LOG_DIR, exist_ok=True)


def timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log_line(text: str):
    """Append a single line to the log file with timestamp."""
    ensure_paths()
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp()}] {text.rstrip()}\n")


def build_kolla_command(action: str,
                        node: Optional[str] = None,
                        service: Optional[str] = None) -> str:
    """
    Build the kolla-ansible command line for the requested action.
    Supported actions:
      - mariadb_recovery
      - reconfigure_all
      - reconfigure_node
      - reconfigure_service
      - reconfigure_node_service
    """
    base = f"kolla-ansible -i {INVENTORY}"

    if action == "mariadb_recovery":
        return f"{base} mariadb_recovery"

    if action == "reconfigure_all":
        return f"{base} reconfigure"

    if action == "reconfigure_node":
        if not node:
            raise ValueError("Missing 'node' for action 'reconfigure_node'")
        return f"{base} reconfigure --limit {shlex.quote(node)}"

    if action == "reconfigure_service":
        if not service:
            raise ValueError("Missing 'service' for action 'reconfigure_service'")
        return f"{base} reconfigure --tags {shlex.quote(service)}"

    if action == "reconfigure_node_service":
        if not node or not service:
            raise ValueError("Missing 'node' or 'service' for action 'reconfigure_node_service'")
        return f"{base} reconfigure --limit {shlex.quote(node)} --tags {shlex.quote(service)}"

    raise ValueError(f"Unsupported action '{action}'")


def start_background_kolla(command: str) -> dict:
    """
    Start the kolla-ansible command in the background:
      - cd to WORK_DIR
      - source virtualenv + openrc
      - run command
      - append stdout/stderr to LOG_FILE
    Returns dict with pid and a job_id.
    """
    ensure_paths()

    # Full shell command: cd -> source env -> run command
    shell_cmd = f"cd {shlex.quote(WORK_DIR)} && {ENV_CMD} && {command}"
    job_id = f"job-{int(time.time())}"

    # Write prologue to logs
    log_line("============================================================")
    log_line(f"JOB START {job_id}")
    log_line(f"WORK_DIR: {WORK_DIR}")
    log_line(f"COMMAND: {command}")

    # We will tee the process output into the log file line-by-line using a thread
    def runner():
        try:
            with subprocess.Popen(
                shell_cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                executable="/bin/bash",
                preexec_fn=os.setpgrp  # detach from flask worker's process group
            ) as proc:
                # Stream stdout -> log file
                for line in proc.stdout:
                    # Write raw line (not double timestamping the ansible progress lines)
                    with open(LOG_FILE, "a", encoding="utf-8") as f:
                        f.write(line)
                rc = proc.wait()
                log_line(f"JOB END {job_id} (returncode={rc})")
                log_line("============================================================")
        except Exception as e:
            log_line(f"JOB ERROR {job_id}: {e}")

    t = threading.Thread(target=runner, daemon=True)
    t.start()

    # We can’t get the child PID easily post-thread; if you want true PID, spawn before thread.
    # For API, we return the shell_cmd and job_id (frontend will stream logs anyway).
    return {
        "job_id": job_id,
        "shell_cmd": shell_cmd
    }


@app.route("/kolla/run", methods=["POST"])
def kolla_run():
    """
    Start a kolla-ansible action in the background and return immediately.
    Body JSON:
      {
        "action": "mariadb_recovery" | "reconfigure_all" | "reconfigure_node" |
                  "reconfigure_service" | "reconfigure_node_service",
        "node": "FD-001",         # optional, required for node actions
        "service": "nova"         # optional, required for service actions
      }
    """
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    node = data.get("node")
    service = data.get("service")

    if not action:
        return jsonify({"error": "Missing 'action'"}), 400

    try:
        cmd = build_kolla_command(action, node=node, service=service)
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400

    # Start background job
    result = start_background_kolla(cmd)
    return jsonify({
        "status": "started",
        "job_id": result["job_id"],
        "command": cmd,
        "log_file": LOG_FILE
    })


@app.route("/kolla/logs/last", methods=["GET"])
def kolla_logs_last():
    """
    Return the last N lines of the log file.
    Query: ?lines=200
    """
    lines = int(request.args.get("lines", 200))
    ensure_paths()
    if not os.path.exists(LOG_FILE):
        return jsonify({"log": [], "lines": 0})

    # Efficient tail
    def tail(filepath, n):
        with open(filepath, "rb") as f:
            avg_line_len = 200
            to_read = n * avg_line_len
            try:
                f.seek(0, os.SEEK_END)
                file_size = f.tell()
                f.seek(max(file_size - to_read, 0), os.SEEK_SET)
            except OSError:
                f.seek(0)
            lines_bytes = f.read().splitlines()[-n:]
            return [lb.decode("utf-8", errors="replace") for lb in lines_bytes]

    last = tail(LOG_FILE, lines)
    return jsonify({"log": last, "lines": len(last)})


@app.route("/kolla/logs/stream", methods=["GET"])
def kolla_logs_stream():
    """
    Server-Sent Events (SSE) endpoint to live-tail the log file.
    Frontend can connect with EventSource('/kolla/logs/stream').
    """
    ensure_paths()

    def generate():
        # Start at end of file
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            f.seek(0, os.SEEK_END)
            while True:
                line = f.readline()
                if line:
                    # SSE format: "data: <line>\n\n"
                    yield f"data: {line.rstrip()}\n\n"
                else:
                    time.sleep(0.5)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no"  # disable buffering on some proxies
    }
    return Response(stream_with_context(generate()), headers=headers)


# (Optional) Simple health
@app.route("/kolla/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "work_dir": WORK_DIR, "log_file_exists": os.path.exists(LOG_FILE)})


#--------------------------------------------Openstack Operation End-------------------------------------------

#--------------------------------------------Lifecycle Management Start-------------------------------------------

UPLOAD_FOLDER = "/home/pinaka/.pinaka_wd/lifecycle/"
ZIP_PASSWORD = b"1@P1@n@k@1609zip123"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
JOBS_DIR = os.path.join(UPLOAD_FOLDER, "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

def _job_file(job_id: str) -> str:
    return os.path.join(JOBS_DIR, f"{job_id}.json")

def save_job_status(job_id: str, data: dict):
    tmp_path = _job_file(job_id) + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_path, _job_file(job_id))

def load_job_status(job_id: str) -> Optional[dict]:
    path = _job_file(job_id)
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json.load(f)

def any_active_job_running() -> bool:
    """Return True if any job in JOBS_DIR is currently running."""
    try:
        for fname in os.listdir(JOBS_DIR):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(JOBS_DIR, fname), "r") as f:
                    data = json.load(f)
                    if data.get("state") == "running":
                        return True
            except Exception:
                # Ignore malformed job files
                continue
    except FileNotFoundError:
        return False
    return False

def is_zip_encrypted(zip_path):
    """Check if the ZIP file is encrypted."""
    with zipfile.ZipFile(zip_path) as zf:
        try:
            zf.testzip()  # Try reading without a password
            return False  # If it succeeds, it's NOT encrypted
        except RuntimeError:
            return True  # If it raises an error, it's encrypted

@app.route("/upload", methods=["POST"])
def upload_file():
    # Prevent concurrent runs while a script is active
    if any_active_job_running():
        return jsonify({"error": "A script is already running. Please wait for it to finish."}), 409

    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".zip"):
        return jsonify({"error": "Only .zip files are allowed"}), 400

    filename = file.filename
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    extract_folder = os.path.join(UPLOAD_FOLDER, filename[:-4])
    file.save(file_path)

    job_id = str(uuid.uuid4())
    job_status = {
        "job_id": job_id,
        "filename": filename,
        "created_at": int(time.time()),
        "state": "queued",
        "message": "Upload received",
    }
    save_job_status(job_id, job_status)

    def process_upload(job_id: str, file_path: str, extract_folder: str, host_ip: str):
        is_valid = True
        readme_content = "README file not found."
        status = load_job_status(job_id) or {}
        try:
            # Mark as running
            status.update({
                "state": "running",
                "message": "Script starting",
                "started_at": int(time.time()),
            })
            save_job_status(job_id, status)

            # Check encryption
            if not is_zip_encrypted(file_path):
                raise ValueError("ZIP file is not PP")

            # Extract using password
            with zipfile.ZipFile(file_path) as zf:
                try:
                    zf.extractall(extract_folder, pwd=ZIP_PASSWORD)
                except RuntimeError:
                    raise ValueError("Invalid code")

            # Validate structure
            pinaka_folder = os.path.join(extract_folder, "pinaka")
            if not os.path.exists(pinaka_folder) or not os.path.isdir(pinaka_folder):
                raise ValueError("Invalid file structure")

            # Read README
            readme_file_path = os.path.join(pinaka_folder, "README")
            if os.path.exists(readme_file_path):
                with open(readme_file_path, "r") as readme_file:
                    readme_content = readme_file.read()

            # Ensure only upgrade.sh exists
            shell_scripts = [f for f in os.listdir(pinaka_folder) if f.endswith(".sh")]
            if len(shell_scripts) != 1 or "upgrade.sh" not in shell_scripts:
                raise ValueError("Invalid file(s) found")

            upgrade_script = os.path.join(pinaka_folder, "upgrade.sh")
            os.chmod(upgrade_script, 0o755)

            # Run script
            result = subprocess.run(
                ["sudo", "bash", upgrade_script],
                cwd=pinaka_folder,
                capture_output=True,
                text=True,
            )

            # Update final status
            terminal = {
                "finished_at": int(time.time()),
                "output": result.stdout,
                "errors": result.stderr,
                "readme": readme_content,
            }
            if result.returncode == 0:
                status.update({"state": "succeeded", "message": "Script finished successfully", **terminal})
            else:
                is_valid = False
                status.update({
                    "state": "failed",
                    "message": f"Script exited with code {result.returncode}",
                    **terminal
                })
            save_job_status(job_id, status)

            # On success, push lifecycle history to Node backend
            if status.get("state") == "succeeded":
                try:
                    info_line = None
                    if readme_content:
                        for line in readme_content.splitlines():
                            m = re.search(r"^\s*INFO\s*:\s*(.+)$", line, re.IGNORECASE)
                            if m:
                                info_line = m.group(1).strip()
                                break
                    if not info_line:
                        info_line = "Patch applied"

                    payload = {
                        "id": job_id,
                        "info": info_line,
                        # finished_at is epoch seconds; Node accepts number and normalizes
                        "date": status.get("finished_at") or int(time.time()),
                    }
                    url = f"https://{host_ip}:5000/api/lifecycle-history"
                    # Best-effort; ignore SSL in local dev and time out quickly
                    data_bytes = json.dumps(payload).encode("utf-8")
                    req = urllib.request.Request(url, data=data_bytes, headers={"Content-Type": "application/json"}, method="POST")
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
                        _ = resp.read()
                except Exception as ex:
                    logging.exception("Failed to store lifecycle history in Node backend: %s", ex)

        except ValueError as e:
            is_valid = False
            status.update({
                "state": "failed",
                "message": str(e),
                "finished_at": int(time.time()),
            })
            save_job_status(job_id, status)
        except Exception as e:
            is_valid = False
            status.update({
                "state": "failed",
                "message": f"Unexpected error: {str(e)}",
                "finished_at": int(time.time()),
            })
            save_job_status(job_id, status)
        finally:
            if not is_valid:
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception:
                        pass
                if os.path.exists(extract_folder):
                    os.system(f"rm -rf {extract_folder}")

    # Accept host_ip from client, fallback to request host header (e.g. 10.0.0.5:2020 -> 10.0.0.5)
    try:
        host_ip = (
            request.form.get("host_ip") or
            ((request.get_json(silent=True) or {}).get("host_ip")) or
            request.args.get("host_ip") or
            request.headers.get("X-Host-IP") or
            (request.host or "").split(":")[0] or
            "localhost"
        )
    except Exception:
        host_ip = "localhost"
    threading.Thread(target=process_upload, args=(job_id, file_path, extract_folder, host_ip), daemon=True).start()

    return jsonify({"job_id": job_id, "status": "queued", "message": "Upload received"}), 202

@app.route("/upload/status/<job_id>", methods=["GET"])
def upload_status(job_id):
    status = load_job_status(job_id)
    if not status:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(status), 200


#--------------------------------------------Lifecycle Management End-------------------------------------------


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=2020,
        debug=True,
        ssl_context=("keycloak.crt", "keycloak.key"),  # (certificate, private key)
    )
