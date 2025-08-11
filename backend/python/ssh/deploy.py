from flask import Flask, request, jsonify
from flask_cors import CORS
import paramiko
import logging

# Initialize Flask app
app = Flask(__name__)

# Enable CORS
CORS(app)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/')
def home():
    return "Flask app is running"

@app.route('/deploy', methods=['POST'])
def deploy():
    # Get JSON data from the request
    data = request.get_json()
    logger.info(f"Received data: {data}") 

    # Use the correct keys as defined in the frontend
    host = data['host']
    username = data['username']
    password = data['password']

    # Initialize SSH client
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Connect to the remote server
        ssh.connect(hostname=host, username=username, password=password)
        logger.info(f"Successfully connected to {host}")

        # Execute the command to run the Python script from the URL
        # command  = 'sudo apt install curl -y'
        command = 'sudo apt install curl -y && python3 <(curl -H "Authorization: token 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" -L "https://raw.githubusercontent.com/Pinakastra-Computing/pinaka-zerotouch/main/ZTi_AIO/All-in-one.py" | python3 -)'
        logger.info(f"Executing command: {command}")
        stdin, stdout, stderr = ssh.exec_command(command)

        # Fetch the output and errors
        output = stdout.read().decode()
        errors = stderr.read().decode()

        # Get the exit status
        exit_status = stdout.channel.recv_exit_status()

        # Close the SSH connection
        ssh.close()

        # Print output and errors to console
        if exit_status != 0:  # Check for command execution failure
            logger.error(f"Command execution failed with exit status {exit_status}")
            if errors:
                logger.error(f"Errors: {errors.strip()}")
            return jsonify({"status": "error", "message": errors or "Command failed with unknown error"}), 500
        else:  # Command executed successfully
            logger.info(f"Command executed successfully. Output:\n{output.strip()}")
            return jsonify({"status": "success", "output": output.strip()}), 200

    except Exception as e:
        logger.exception("An error occurred during SSH connection or command execution")
        return jsonify({"status": "error", "message": str(e)}), 500

# Run the app
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=8080,
        ssl_context=(
            "/etc/ssl/keycloak.crt",
            "/etc/ssl/keycloak.key"
        )
    )

