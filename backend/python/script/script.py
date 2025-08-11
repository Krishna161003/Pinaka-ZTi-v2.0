from flask import Flask, request, jsonify
import os

app = Flask(__name__)

UPLOAD_FOLDER = '/home/d/'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

@app.route('/')
def home():
    return "Flask app is running"

@app.route('/hardware-info', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'message': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'No selected file'}), 400

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)

    return jsonify({'message': f'File {file.filename} uploaded successfully'}), 200

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=8888,
        ssl_context=(
            "/etc/ssl/keycloak.crt",
            "/etc/ssl/keycloak.key"
        )
    )
