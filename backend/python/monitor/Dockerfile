# Use the official Python base image
FROM python:3.9-slim

# Set the working directory inside the container
WORKDIR /app

# Install system dependencies (e.g., for tail, sudo and grep)
RUN apt-get update && apt-get install -y \
    sudo \
    grep \
    coreutils \
    && apt-get clean

# Install Python dependencies from requirements.txt
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Create the markers directory inside the container to simulate the deployment process
RUN mkdir -p /home/pinaka/markers

# Ensure the app can write to the markers directory (set appropriate permissions)
RUN chown -R root:root /home/pinaka/markers && chmod -R 777 /home/pinaka/markers

# Copy the application code (server.py) into the container's /app directory
COPY server.py /app/

# Expose the port the app will run on
EXPOSE 5055

# Run the Flask app
CMD ["python", "server.py"]
