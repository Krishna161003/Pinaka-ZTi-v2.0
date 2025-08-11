from pyghmi.ipmi import command
import sys

def set_pxe_boot(bmc_ip, bmc_username, bmc_password, role):
    try:
        # Create an IPMI command instance
        ipmi_cmd = command.Command(bmc=bmc_ip, userid=bmc_username, password=bmc_password)
        
        # Set the boot device to PXE
        ipmi_cmd.set_bootdev('network')

        # Additional configuration based on the role
        if role == 'HCI':
            # Additional configuration for HCI
            pass
        elif role == 'Compute&Storage':
            # Additional configuration for Compute&Storage
            pass

        # Power cycle the server
        ipmi_cmd.reboot()

        return {"status": "success", "message": f"PXE boot order set for role {role} and system rebooted"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    bmc_ip = sys.argv[1]
    bmc_username = sys.argv[2]
    bmc_password = sys.argv[3]
    role = sys.argv[4]
    result = set_pxe_boot(bmc_ip, bmc_username, bmc_password, role)
    print(result)
