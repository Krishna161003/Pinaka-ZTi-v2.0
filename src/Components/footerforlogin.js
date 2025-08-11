import React from 'react';
import '../Styles/Footer.css';
const Footer = () => {
  return (
    <footer style={footerStyle}>
      <p>&copy;<a href="https://pinakastra.com" style={linkStyle}> Turn-Key Cloud Platform for Academia, Research & Enterprises</a></p>
      {/* <p>Contact us: <a href="mailto:cloud@pinakastra.com">cloud@pinakastra.com</a> | <a href="tel:+919008488882">+91 90084 88882</a></p> */}
    </footer>
  );
};

const footerStyle = {
  background: '#f0f2f5',  /* Light background color */
  color: '#555',           /* Text color */
  textAlign: 'center',
  padding: '0px',
  position: 'fixed',
  left: '0',
  bottom: '0',
  width: '100%',
};

const linkStyle = {
  textDecoration: 'none',  /* Remove underline */
  color: '#555',            /* Text color */
  cursor: 'pointer',        /* Change cursor to pointer on hover */
};

export default Footer;