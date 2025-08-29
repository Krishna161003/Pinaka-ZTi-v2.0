import React, { useState } from 'react';
import styles from '../Styles/Login.module.css';
import { LockOutlined, HomeOutlined } from '@ant-design/icons';
import { Button, Alert, Input } from 'antd';
import 'bootstrap/dist/css/bootstrap.min.css';
import axios from 'axios';
import img1 from '../Images/ZTi.png';
import { useNavigate } from 'react-router-dom';

const hostIP = window.location.hostname;


const Login = ({ checkLogin = () => {} }) => {
  const navigate = useNavigate();
  const [ssoFormData, setSSOFormData] = useState({
    companyName: '',
    password: ''
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSSOChange = (e) => {
    setSSOFormData({
      ...ssoFormData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSSOSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { companyName, password } = ssoFormData;

    try {
      let secretResponse;
      try {
        secretResponse = await axios.get(`https://${hostIP}:2020/get-client-secret`, {
          timeout: 10000
        });
      } catch (err) {
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED' || err.message?.includes('Network Error')) {
          throw new Error('Unable to connect to the server. Please check your network connection.');
        }
        throw new Error('Failed to connect to authentication service. Please try again later.');
      }

      const { client_secret: encodedSecret, random_char_pos: randomCharPos } = secretResponse?.data || {};

      if (!encodedSecret || randomCharPos === undefined) {
        throw new Error('Authentication service configuration error. Please contact support.');
      }

      const clientSecret = encodedSecret.slice(0, randomCharPos) + encodedSecret.slice(randomCharPos + 1);

      let tokenResponse;
      try {
        tokenResponse = await axios.post(
          `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: 'zti-client',
            client_secret: clientSecret,
          }),
          {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
      } catch (err) {
        if (err.response) {
          if (err.response.status === 401) {
            throw new Error('Authentication service is currently unavailable. Please try again later.');
          }
          throw new Error('Authentication service error. Please try again.');
        } else if (err.request) {
          throw new Error('Unable to reach authentication service. Please check your connection.');
        }
        throw err;
      }

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        throw new Error('Failed to obtain access token. Please try again.');
      }

      let userResponse;
      try {
        userResponse = await axios.post(
          `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
          new URLSearchParams({
            grant_type: 'password',
            username: companyName,
            password: password,
            client_id: 'zti-client',
            client_secret: clientSecret,
            scope: 'openid',
          }),
          {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );
      } catch (err) {
        if (err.response) {
          if (err.response.status === 401) {
            throw new Error('Invalid username or password. Please try again.');
          } else if (err.response.status === 400) {
            throw new Error('Invalid request. Please check your credentials and try again.');
          } else if (err.response.status >= 500) {
            throw new Error('Authentication service is currently unavailable. Please try again later.');
          }
        }
        throw err;
      }

      if (!userResponse?.data?.access_token) {
        throw new Error('Authentication failed. Please try again.');
      }

      sessionStorage.setItem('accessToken', userResponse.data.access_token);

      let userDetailsResponse;
      try {
        userDetailsResponse = await axios.get(
          `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/userinfo`,
          {
            timeout: 10000,
            headers: {
              'Authorization': `Bearer ${userResponse.data.access_token}`,
            },
          }
        );
      } catch (err) {
        console.error('Failed to fetch user details:', err);
        // Continue with login even if user details fetch fails
      }

      const userId = userDetailsResponse?.data?.sub || 'unknown';

      const loginDetails = {
        loginStatus: true,
        data: {
          companyName: companyName,
          id: userId,
        },
      };

      sessionStorage.setItem('loginDetails', JSON.stringify(loginDetails));

      try {
        await axios.post(`https://${hostIP}:5000/store-user-id`, { userId }, { timeout: 5000 });
      } catch (err) {
        console.error('Failed to store user ID:', err);
        // Continue with login even if storing user ID fails
      }

      // Call checkLogin before navigation
      if (typeof checkLogin === 'function') {
        checkLogin(true);
      }
      navigate('/', { replace: true, state: { notification: 'Login successful! Welcome back!' } });
    } catch (err) {
      console.error('Login error:', err);
      // Show user-friendly error message
      const errorMessage = err.response?.data?.message || 
                         (err.code === 'ECONNABORTED' ? 'Connection timeout. Please check your network.' : 
                         'Invalid credentials or server error. Please try again.');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderSSOForm = () => (
    <form name="sso-login" onSubmit={handleSSOSubmit}>
      <div className={styles.formGroup}>
        <label>Username</label>
        <Input
          prefix={<HomeOutlined style={{ color: '#6b7280' }} />}
          type="text"
          name="companyName"
          value={ssoFormData.companyName}
          onChange={handleSSOChange}
          placeholder="Enter your username"
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label>Password</label>
        <Input.Password
          prefix={<LockOutlined style={{ color: '#6b7280' }} />}
          name="password"
          value={ssoFormData.password}
          onChange={handleSSOChange}
          placeholder="Enter your password"
          required
        />
      </div>
      {error && <Alert message={error} type="error" showIcon />}
      <Button 
        type="primary" 
        htmlType="submit" 
        loading={loading}
        block
      >
        {loading ? 'Logging in...' : 'LOGIN'}
      </Button>
    </form>
  );

  return (
    <div className={styles.App}>
      <div className="container-fluid p-0">
        <div className="row g-0 min-vh-100">
          <div className={`col-lg-7 ${styles.bgImage}`}></div>
          <div className="col-lg-5 d-flex align-items-center justify-content-center">
            <div className={styles.loginForm}>
              <div className={styles.logoContainer}>
                <img src={img1} alt="Logo" className={styles.logo} />
              </div>
              <h1 className={styles.welcomeTitle}>Welcome back</h1>
              {/* <p className={styles.subtitle}>Login to the Dashboard</p> */}
              {renderSSOForm()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
