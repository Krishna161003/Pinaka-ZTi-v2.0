import hashlib
import json
import secrets  # Stronger randomness source
import psutil  # To get network interfaces
import os

# Function to get the number of CPU sockets
def get_cpu_socket_count():
    try:
        # Read the CPU information from /proc/cpuinfo (Linux-specific)
        if os.path.exists("/proc/cpuinfo"):
            with open("/proc/cpuinfo", "r") as cpuinfo:
                sockets = set()
                for line in cpuinfo:
                    if line.startswith("physical id"):
                        # Extract unique physical IDs
                        sockets.add(line.split(":")[1].strip())
                return len(sockets)
        else:
            print("This script is designed to work on Linux systems.")
            return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None

# Function to generate a unique encryption code (12 characters)
def generate_unique_code(mac_address, key, existing_codes, lookup_table, key_type, socket_count):
    # Concatenate MAC address, key, key type, and the number of CPU sockets
    unique_input = mac_address + key + key_type + str(socket_count)

    # Generate the SHA-256 hash of the concatenated string
    hash_object = hashlib.sha256(unique_input.encode())
    full_hash = hash_object.hexdigest()

    # Take the first 12 characters of the hash as the unique code
    code = full_hash[:12]

    # Ensure uniqueness by checking the existing codes
    attempts = 0
    while code in existing_codes:
        # If the code already exists, append a random number and rehash
        attempts += 1
        unique_input = mac_address + key + key_type + str(socket_count) + str(secrets.randbelow(100000))  # Use stronger randomness
        hash_object = hashlib.sha256(unique_input.encode())
        full_hash = hash_object.hexdigest()
        code = full_hash[:12]

        # Avoid an infinite loop: log after several attempts
        if attempts > 100:
            print("Warning: Multiple attempts to generate a unique code failed.")
            break

    # Add the new code to the set of existing codes
    existing_codes.add(code)

    # Store the original MAC address, key, key type, and socket count for decryption
    lookup_table[code] = {"mac_address": mac_address, "key": key, "key_type": key_type, "socket_count": socket_count}

    return code

# Function to get all MAC addresses of network interfaces
def get_mac_addresses():
    mac_addresses = []
    interfaces = psutil.net_if_addrs()
    for interface, addrs in interfaces.items():
        for addr in addrs:
            if addr.family == psutil.AF_LINK:
                mac = addr.address
                # Ensure it's a valid MAC address
                if len(mac.split(":")) == 6:
                    mac_addresses.append(mac)
    return mac_addresses

# Main script
if __name__ == "__main__":
    # Key options
    key_options = {
    "triennial": "TriennialKeydMCiZyP2XgR9npch6JBqj1oHsaVxbmUYrE3NLI8OvzTQlF4fwt7W5KGAkDuSe",
    "yearly": "YearlyKeyZeElYW43XygSe916TfoFy5BHPzLCIKYlGyrDe2adK8JqMRscnNubaw7xiOpUt",
    "perpetual": "PerpetualKeyWoxnEIv2CHdejV81DbfrhAamL4JtMiOFZT3RY79cypKNsQG6UBz5quklXwSgP",
    "trial": "TrialKey9T8bx1mVYqXuPrtjyz5J4eGHBSnsUIdZl3RcvfCwKFaDgLhko6EAO7QMp2iNW",
    }
    # To keep track of already generated codes and lookup table
    existing_codes = set()
    lookup_table = {}

    # Get all MAC addresses
    mac_addresses = get_mac_addresses()
    if not mac_addresses:
        print("No valid MAC addresses found. Exiting.")
        exit(1)

    # Get the number of CPU sockets
    socket_count = get_cpu_socket_count()
    if socket_count is None:
        print("Unable to retrieve CPU socket count. Exiting.")
        exit(1)

    print(f"Number of CPU sockets: {socket_count}")

    # Generate keys for each license type and each MAC address
    for key_type, key in key_options.items():
        filename = f"{key_type}_keys.json"
        key_data = {}

        for mac_address in mac_addresses:
            unique_code = generate_unique_code(mac_address, key, existing_codes, lookup_table, key_type, socket_count)
            key_data[mac_address] = unique_code

        # Save the keys for this license type in a JSON file
        with open(filename, 'w') as f:
            json.dump(key_data, f, indent=4)

        # print(f"Keys for {key_type.capitalize()} license stored in {filename}.")

    # Save the lookup table in a separate JSON file
    with open('lookup_table.json', 'w') as f:
        json.dump(lookup_table, f, indent=4)

    print("All keys and lookup table have been successfully generated and stored.")

