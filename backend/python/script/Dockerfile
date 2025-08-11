# Use the official Python image from the Docker Hub
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app/

# Install dependencies using requirements.txt
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Create the directory for file uploads
RUN mkdir -p /home/data

# Expose port 8888 for external access
EXPOSE 8888

# Define environment variable
ENV FLASK_APP=script.py

# Start the application using Gunicorn with HTTPS
CMD ["python", "script.py"]


