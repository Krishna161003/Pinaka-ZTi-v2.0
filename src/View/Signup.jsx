import React, { useState } from 'react';
import '../Styles/Signup.css';
import { LockOutlined, HomeOutlined, MailOutlined } from '@ant-design/icons';
import { Button, Input, Alert, notification, Spin } from 'antd'; // Added Spin component for global loader
import 'bootstrap/dist/css/bootstrap.min.css';
import axios from 'axios';
import tick from '../Images/tick.gif';
import img1 from '../Images/ZTi.png';
import { Link } from 'react-router-dom';
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';

const Signup = () => {
    const [formData, setFormData] = useState({
        companyName: '',
        email: '',
        password: '',
        confirmPassword: '',
    });

    const [error, setError] = useState('');
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const [registeredUser, setRegisteredUser] = useState('');
    const [loading, setLoading] = useState(false); // Loading state for button and global loader
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
   const hostIP = window.location.hostname;  //retrive host ip



    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { companyName, email, password, confirmPassword } = formData;

        // Validation checks
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters long');
            return;
        }

        if (!/[A-Z]/.test(password)) {
            setError('Password must contain at least one uppercase letter!');
            return;
        }

        if (!/[a-z]/.test(password)) {
            setError('Password must contain at least one lowercase letter!');
            return;
        }

        if (!/\d/.test(password)) {
            setError('Password must contain at least one digit!');
            return;
        }

        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            setError('Password must contain at least one special character!');
            return;
        }

        // Show the loading spinner when user clicks register
        setLoading(true);

        try {
            const response = await axios.post(`https://${hostIP}:5000/register`, { companyName, email, password });
            setRegistrationSuccess(true);
            setRegisteredUser(companyName);

            setFormData({
                companyName: '',
                email: '',
                password: '',
                confirmPassword: '',
            });
            setError('');
            setLoading(false); // Stop loading once registration is complete
        } catch (err) {
            setLoading(false);
            if (err.response && err.response.status === 400) {
                setError(err.response.data.message); // Display "Email already registered"
            } else {
                setError('Error registering user');
            }
        }
    };


    return (
        <div className="App">
            <div className="container-fluid ps-md-0">
                <div className="row g-0">
                    <div className="d-md-flex col-md-8 col-lg-6 bg-image"></div>
                    <div className="col-md-8 col-lg-6">
                        <div className="container">
                            <div className="registration-form">
                                <img src={img1} alt="Logo" className="logo" />
                                {registrationSuccess ? (
                                    <div className="success-message">
                                        <img src={tick} alt="Success Tick" className="tick" />
                                        <h2>Registration Success</h2>
                                        <p>Your account name is: <strong>{registeredUser}</strong></p>
                                        <p>Please check your <b>Email</b> for your <b>UserID</b></p>
                                        <div className="login-prompt">
                                            <p>Please <Link to="/">login</Link> to continue</p>
                                        </div>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit}>
                                        <div className="form-group">
                                            <label>Company Name:</label>
                                            <Input
                                                prefix={<HomeOutlined style={{ marginRight: 8 }} />}
                                                type="text"
                                                name="companyName"
                                                value={formData.companyName}
                                                onChange={handleChange}
                                                placeholder="Enter your company name"
                                                required
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Email:</label>
                                            <Input
                                                prefix={<MailOutlined style={{ marginRight: 8 }} />}
                                                type="email"
                                                name="email"
                                                value={formData.email}
                                                onChange={handleChange}
                                                placeholder="Enter your email address"
                                                required
                                            />
                                        </div>


                                        <div className="form-group">
                                            <label>Password:</label>
                                            <Input
                                                prefix={<LockOutlined style={{ marginRight: 8 }} />}
                                                type={passwordVisible ? 'text' : 'password'}
                                                name="password"
                                                value={formData.password}
                                                onChange={handleChange}
                                                placeholder="Enter your password"
                                                required
                                                suffix={
                                                    <div
                                                        onClick={() => setPasswordVisible(!passwordVisible)}
                                                        style={{ cursor: 'pointer', opacity: 0.6 }} // Adjust the opacity here
                                                    >
                                                        {passwordVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                                    </div>
                                                }
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label>Confirm Password:</label>
                                            <Input
                                                prefix={<LockOutlined style={{ marginRight: 8 }} />}
                                                type={confirmPasswordVisible ? 'text' : 'password'}
                                                name="confirmPassword"
                                                value={formData.confirmPassword}
                                                onChange={handleChange}
                                                placeholder="Confirm your password"
                                                required
                                                suffix={
                                                    <div
                                                        onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                                                        style={{ cursor: 'pointer', opacity: 0.6 }} // Adjust the opacity here
                                                    >
                                                        {confirmPasswordVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                                    </div>
                                                }
                                            />
                                        </div>
                                        {error && <Alert message={error} type="error" showIcon />}

                                        {/* Loader applied directly to the Register button */}
                                        <Button
                                            type="primary"
                                            htmlType="submit"
                                            loading={loading} // Show spinner when loading is true
                                            disabled={loading} // Disable button while loading
                                        >
                                            Register
                                        </Button>
                                    </form>
                                )}
                                {!registrationSuccess && (
                                    <div className="login-prompt">
                                        <p>or</p>
                                        <p><Link to="/">Already Registered?/Login</Link></p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Global loader visible when registration is in progress */}

        </div>
    );
};

export default Signup;
