# Use the official Python image as the base image
FROM python:3.9-slim

# Set the working directory
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy only the necessary files for the Flask application
COPY deploy.py ./

# Expose the port the app runs on
EXPOSE 8080

# Command to run the Flask application
CMD ["python", "deploy.py"]
