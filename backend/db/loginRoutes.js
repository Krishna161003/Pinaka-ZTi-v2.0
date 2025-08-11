const express = require("express");
const router = express.Router();
const db = require("./db");
const bcrypt = require("bcrypt");

router.post("/login", (req, res) => {
  const { id, companyName, password } = req.body;

  const query = "SELECT * FROM users WHERE id = ? AND companyName = ?";
  db.query(query, [id, companyName], async (err, results) => {
    if (err) {
      console.error("Error fetching user from database:", err);
      return res.status(500).send("Error logging in");
    }
    if (results.length > 0) {
      const user = results[0];

      // Compare the entered password with the hashed password stored in the database
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        return res
          .status(200)
          .json({ success: true, message: "Login successful", data: user });
      } else {
        return res.status(401).send({ success: false, message: 'Invalid credentials' });
      }
    } else {
      return res.status(401).send({ success: false, message: 'Invalid credentials' });
    }
  });
});

module.exports = router;
