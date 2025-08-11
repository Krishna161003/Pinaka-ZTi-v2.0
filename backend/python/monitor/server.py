from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import os
import logging
import time
import threading
from subprocess import Popen, PIPE
import sys
import signal
import atexit

# Initialize Flask app
app = Flask(__name__)

# Enable CORS for all routes and all origins
CORS(app)
deployments = {}  # Dictionary to track deployment states
# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Starting Flask app...")

# Expected files for deployment progress
# Define expected_files globally so that it's accessible to all functions
expected_files = [
    'script1_done', 'script2_done', 'script3_done', 'script4_done',
    'script5_done', 'script6_done', 'script7_done', 'credentials.json','script8_done'
]

# Function to handle tailing in a separate thread
def tail_logs_in_background(targetserver_ip):
    """Run the tailing process in a background thread."""
    thread = threading.Thread(target=tail_files_in_order, args=(targetserver_ip,))
    thread.daemon = True  # Ensure thread dies when main program exits
    thread.start()

def get_deployment_progress(targetserver_ip):
    """Function to calculate the deployment progress based on the files present for a given IP."""
    markers_directory = f'/home/pinaka/markers/{targetserver_ip}'  # Dynamically set directory path based on IP
    
    if not os.path.exists(markers_directory):
        logger.warning(f"Markers directory for IP {targetserver_ip} does not exist.")
        return 0, []  # Return 0% progress if the directory doesn't exist

    try:
        files_in_directory = set(os.listdir(markers_directory))
    except Exception as e:
        logger.error(f"Error accessing markers directory: {e}")
        return 0, []  # If there's an error accessing the directory, return 0% progress
    
    present_files = [file for file in expected_files if file in files_in_directory]
    progress = round((len(present_files) / len(expected_files)) * 100, 2)
    return progress, present_files

def tail_file(file_path):
    """Helper function to tail the content of a file."""
    with open(file_path, 'r') as file:
        logger.info(f"Tailing file: {file_path}")
        while True:
            line = file.readline()
            if not line:
                # If no new line, sleep briefly to avoid constant CPU usage
                time.sleep(0.1)
                continue
            logger.info(f"New log line: {line.strip()}")
            yield f"data: {line.strip()}\n\n"  # Yield new log line to the frontend

def tail_files_in_order(targetserver_ip):
    """Tail files in the order specified in expected_files."""
    markers_directory = f'/home/pinaka/markers/{targetserver_ip}'

    # Wait for each expected file in sequence
    for file in expected_files:
        file_path = os.path.join(markers_directory, file)

        # Wait for the file to appear
        while not os.path.exists(file_path):
            logger.info(f"File {file_path} not found, waiting for it to appear...")
            time.sleep(2)  # Poll every 2 seconds until the file appears

        logger.info(f"Found file {file_path}, now tailing...")

        # Tail the current file and process it
        yield from tail_file(file_path)  # Stream the content of the file to the frontend

        # After tailing, proceed to the next file
        logger.info(f"Finished tailing {file_path}. Moving to the next file...")

    # After all files are processed, periodically check for new files
    logger.info("All files processed. Waiting for new files to appear...")
    
    while True:
        logger.info("No more files to tail, waiting for new files...")
        time.sleep(5)  # Wait before checking for new files

        # Check if any new files appear in the directory
        for file in expected_files:
            file_path = os.path.join(markers_directory, file)
            if os.path.exists(file_path):
                logger.info(f"Found new file: {file_path}, now tailing...")
                yield from tail_file(file_path)  # Stream the content of the file to the frontend

@app.route('/get-progress', methods=['GET'])
def get_progress():
    targetserver_ip = request.args.get('targetserver_ip')
    if not targetserver_ip:
        return jsonify({'error': 'IP is required'}), 400

    # Check if the deployment is canceled
    if deployments.get(targetserver_ip) == "canceled":
        return jsonify({'error': 'Deployment canceled'}), 400

    progress, present_files = get_deployment_progress(targetserver_ip)
    return jsonify({'progress': progress, 'present_files': present_files})

@app.route('/start-deployment', methods=['POST'])
def start_deployment():
    try:
        data = request.get_json()
        targetserver_ip = data.get('targetserver_ip')

        # Check if targetserver_ip is provided
        if not targetserver_ip:
            app.logger.error("Missing targetserver_ip in the request")
            return jsonify({'error': 'IP is required'}), 400

        # Check if the deployment is already in progress
        if targetserver_ip in deployments and deployments[targetserver_ip] == 'in_progress':
            app.logger.info(f"Deployment for {targetserver_ip} is already in progress.")
            return jsonify({'error': 'Deployment already in progress'}), 400

        # Mark the deployment as 'in_progress'
        deployments[targetserver_ip] = 'in_progress'
        app.logger.info(f"Starting deployment for {targetserver_ip}")

        # Trigger the actual deployment process here (e.g., call 
        # another function or trigger a background task)
        # Example: start_deployment_task(targetserver_ip)

        return jsonify({'message': f'Deployment for {targetserver_ip} started.'}), 200

    except Exception as e:
        app.logger.error(f"Error during deployment start: {e}")
        return jsonify({'error': 'Failed to start deployment'}), 500


@app.route('/cancel-deployment', methods=['POST'])
def cancel_deployment():
    try:
        data = request.get_json()
        targetserver_ip = data.get('targetserver_ip')

        if not targetserver_ip:
            return jsonify({'error': 'IP is required'}), 400

        if targetserver_ip not in deployments:
            return jsonify({'error': 'Deployment not found for this IP'}), 404
        
        # If deployment is in progress, mark as canceled
        if deployments[targetserver_ip] == "in_progress":
            deployments[targetserver_ip] = "canceled"
            app.logger.info(f"Deployment for {targetserver_ip} has been canceled.")
            return jsonify({'message': f'Deployment for {targetserver_ip} canceled.'}), 200
        
        # If the deployment is already canceled, return an error
        return jsonify({'error': 'Deployment already canceled or not in progress'}), 400

    except Exception as e:
        app.logger.error(f"Error during deployment cancellation: {e}")
        return jsonify({'error': 'Failed to cancel deployment'}), 500


@app.route('/tail-logs')
def tail_logs():
    """Stream log data for deployment progress."""
    targetserver_ip = request.args.get('targetserver_ip')  # Get IP from query parameters
    if not targetserver_ip:
        return jsonify({'error': 'IP is required'}), 400  # Return error if IP is not provided

    # Start tailing logs in the background and return the SSE stream
    tail_logs_in_background(targetserver_ip)
    return Response(tail_files_in_order(targetserver_ip), content_type='text/event-stream')

# Route for streaming logs (SSE)
def tail_log():
    syslog_path = '/var/log/dnsmasq.log'  # The log file you want to tail
    logger.info(f"Starting to tail {syslog_path}")
    
    # Tail the dnsmasq.log file
    process = Popen(f'sudo stdbuf -oL tail -f {syslog_path}', stdout=PIPE, stderr=PIPE, shell=True)
    success_sent = False

    # Read output from the tail process
    while True:
        line = process.stdout.readline().decode('utf-8')
        
        if line:
            # Yield all logs to the frontend (stream full logs)
            yield f"data: {line.strip()}\n\n"

            # If the log line contains "pinaka", send a success message and stop
            if "pinaka" in line:
                logger.info("Pinaka OS boot message detected.")
                yield "data: Successfully booted Pinaka OS\n\n"  # Send success message via SSE
                success_sent = True
                break  # Stop after the success message is sent
        else:
            break  # Exit loop if no more output

    # Terminate the process if success is detected
    if success_sent:
        logger.info("Terminating the tail process after success.")
        process.terminate()

    # In case there's no success and the loop ends, terminate the process anyway
    if not success_sent:
        logger.warning("No success message detected. Terminating process.")
        process.terminate()

@app.route('/events')
def sse():
    """This route streams events from the backend."""
    return Response(tail_log(), content_type='text/event-stream')

@app.route('/')
def index():
    return 'Backend server running'

def cleanup():
    """Cleanup function for graceful shutdown of processes."""
    logger.info("Shutting down Flask server and cleaning up.")
    # Add any additional cleanup logic here if necessary

# Register cleanup function to run on shutdown
atexit.register(cleanup)

# Handling termination signals (Ctrl+C, kill signals)
signal.signal(signal.SIGINT, lambda signum, frame: cleanup())
signal.signal(signal.SIGTERM, lambda signum, frame: cleanup())

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5055,
        ssl_context=(
            "/etc/ssl/keycloak.crt",
            "/etc/ssl/keycloak.key"
        )
    )

