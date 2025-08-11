from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
from scapy.all import ARP, Ether, srp
import psutil
import os
import json
import paramiko
import re
import subprocess
import time
import ipaddress
import netifaces
import logging
from collections import deque



app = Flask(__name__)
CORS(app)

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
    return list(timestamped_cpu_history)

def get_memory_history():
    return list(timestamped_memory_history)

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

def store_network_config(data):
    """Store or update the network config for a node in a canonical JSON file."""
    import threading
    lock = threading.Lock()
    file_path = os.path.join("submitted_configs", "network_configs.json")
    os.makedirs("submitted_configs", exist_ok=True)
    
    # Use hostname or default gateway as key, but not VIP
    key = data.get("hostname") or data.get("default_gateway") or "unknown"
    
    # Remove disk information if present and ensure no pinakasv wrapper
    if 'disk' in data:
        data = {k: v for k, v in data.items() if k != 'disk'}
    
    with lock:
        if os.path.exists(file_path):
            with open(file_path, "r") as f:
                try:
                    configs = json.load(f)
                    # If the config has a pinakasv wrapper, extract the inner data
                    if key in configs and 'pinakasv' in configs[key]:
                        configs[key] = configs[key]['pinakasv']
                except Exception:
                    configs = {}
        else:
            configs = {}
            
        # Store the data directly without pinakasv wrapper
        configs[key] = data
        
        with open(file_path, "w") as f:
            json.dump(configs, f, indent=4)
    return True

def validate_ip_address(ip):
    """Validate an IP address format."""
    try:
        parts = ip.split('.')
        if len(parts) != 4:
            return False
        for part in parts:
            if not part.isdigit() or not 0 <= int(part) <= 255:
                return False
        return True
    except Exception:
        return False

def validate_subnet_mask(mask):
    """Validate a subnet mask."""
    try:
        # Convert to CIDR if it's in dot-decimal notation
        if '.' in mask:
            if not validate_ip_address(mask):
                return False
            # Convert to CIDR notation
            binary_str = ''.join([f"{int(octet):08b}" for octet in mask.split('.')])
            cidr = len(binary_str.rstrip('0'))
            return 0 <= cidr <= 32
        # If it's already in CIDR notation
        cidr = int(mask)
        return 0 <= cidr <= 32
    except (ValueError, AttributeError):
        return False

@app.route("/submit-network-config", methods=["POST"])
def submit_network_config():
    try:
        data = request.get_json(force=True)
        print("✅ Received data:", json.dumps(data, indent=2))

        # Basic validation
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "Invalid configuration format"}), 400

        # Validate using_interfaces
        if "using_interfaces" not in data or not isinstance(data["using_interfaces"], dict):
            return jsonify({"success": False, "message": "Invalid or missing 'using_interfaces'"}), 400

        # Validate default gateway
        if "default_gateway" not in data or not data["default_gateway"]:
            return jsonify({"success": False, "message": "Missing 'default_gateway'"}), 400
        if not validate_ip_address(data["default_gateway"]):
            return jsonify({"success": False, "message": "Invalid default gateway IP address"}), 400

        # Validate hostname
        if "hostname" not in data or not isinstance(data["hostname"], str) or not data["hostname"].strip():
            return jsonify({"success": False, "message": "Hostname cannot be empty"}), 400

        # Validate DNS servers if provided
        if "dns_servers" in data:
            if not isinstance(data["dns_servers"], list):
                return jsonify({"success": False, "message": "'dns_servers' must be a list"}), 400
            for dns in data["dns_servers"]:
                if not validate_ip_address(dns):
                    return jsonify({"success": False, "message": f"Invalid DNS server IP: {dns}"}), 400

        # Validate network interfaces
        for iface_name, iface_config in data["using_interfaces"].items():
            # interface_name
            real_iface = iface_config.get("interface_name", iface_name)
            if not real_iface or not isinstance(real_iface, str):
                return jsonify({"success": False, "message": f"Invalid or missing interface_name for {iface_name}"}), 400
            # type
            iface_type = iface_config.get("type")
            if not iface_type or not isinstance(iface_type, list) or not iface_type:
                return jsonify({"success": False, "message": f"Invalid or missing type for {real_iface}"}), 400
            # vlan_id
            vlan_id = iface_config.get("vlan_id")
            if vlan_id is not None:
                try:
                    vlan_num = int(vlan_id)
                    if not (1 <= vlan_num <= 4094):
                        return jsonify({"success": False, "message": f"Invalid VLAN ID for {real_iface}"}), 400
                except Exception:
                    return jsonify({"success": False, "message": f"Invalid VLAN ID for {real_iface}"}), 400
            # Bond_Slave
            bond_slave = iface_config.get("Bond_Slave")
            if bond_slave and bond_slave not in ["YES", "NO"]:
                return jsonify({"success": False, "message": f"Bond_Slave for {real_iface} must be 'YES' or 'NO'"}), 400
            # Properties
            props = iface_config.get("Properties", {})
            if props and not isinstance(props, dict):
                return jsonify({"success": False, "message": f"Properties for {real_iface} must be a dict"}), 400
            # IP address
            iface_ip = iface_config.get("ip") or props.get("IP_ADDRESS")
            if iface_ip:
                if not validate_ip_address(iface_ip):
                    return jsonify({"success": False, "message": f"Invalid IP address for interface {real_iface}"}), 400
                # Netmask
                netmask = iface_config.get("netmask") or props.get("Netmask")
                if netmask:
                    if not validate_subnet_mask(netmask):
                        return jsonify({"success": False, "message": f"Invalid subnet mask for interface {real_iface}"}), 400
                # Network available
                if not is_network_available(iface_ip):
                    return jsonify({"success": False, "message": f"Network for interface {real_iface} is not available or used by another device"}), 400
            # DNS in Properties
            if "DNS" in props:
                if not validate_ip_address(props["DNS"]):
                    return jsonify({"success": False, "message": f"Invalid DNS IP in Properties for {real_iface}"}), 400
            # gateway in Properties
            if "gateway" in props:
                if not validate_ip_address(props["gateway"]):
                    return jsonify({"success": False, "message": f"Invalid gateway IP in Properties for {real_iface}"}), 400
            # Check if interface exists and is up
            if not is_interface_up(real_iface):
                return jsonify({"success": False, "message": f"Interface {real_iface} is not available or could not be brought up"}), 400

        # Validate default gateway reachability
        if not is_ip_reachable(data["default_gateway"]):
            return jsonify({"success": False, "message": "Default gateway is not reachable"}), 400

        # Validate DNS servers reachability if provided
        if "dns_servers" in data:
            for dns in data["dns_servers"]:
                if not is_ip_reachable(dns):
                    return jsonify({"success": False, "message": f"DNS server {dns} is not reachable"}), 400

        # All validations passed, store the configuration
        store_network_config(data)

        return (
            jsonify({
                "success": True, 
                "message": "Network configuration validated and saved successfully", 
                "key": data.get("hostname") or data.get("default_gateway") or "unknown"
            }),
            200,
        )

# ... (rest of the code remains the same)
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

    # Include the number of CPU sockets in the response
    response = {"interfaces": interfaces}

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

        return {
            "status": status,
            "metrics": {
                "cpu_usage_percent": round(cpu_usage, 2),
                "memory_usage_percent": round(mem_usage, 2),
                "disk_usage_percent": round(disk_usage, 2)
            }
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
# ------------------- System Utilization End -------------------



# ------------------------------------------------ local Interface list End --------------------------------------------
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=2020,
        ssl_context=("cert.pem", "key.pem"),  # (certificate, private key)
    )