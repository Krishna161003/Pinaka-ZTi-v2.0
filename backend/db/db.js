// backend/db.js
const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'mysql-db',
  user: 'root',
  port: 3306, 
  password: 'Likith@172323',
  database: 'standalone'
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database');
});

module.exports = connection;
