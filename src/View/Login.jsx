import React, { useState } from 'react';
import styles from '../Styles/Login.module.css';
import { LockOutlined, HomeOutlined } from '@ant-design/icons';
import { Button, Alert, Input } from 'antd';
import 'bootstrap/dist/css/bootstrap.min.css';
import axios from 'axios';
import img1 from '../Images/ZTi.png';
import { useNavigate } from 'react-router-dom';

const hostIP = window.location.hostname;


const Login = (props) => {
  const { checkLogin } = props;
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
    const { companyName, password } = ssoFormData;

    try {
      // 1. Obtain the access token using client credentials
      const tokenResponse = await axios.post(
        `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'zti-client',
          client_secret: process.env.REACT_APP_CLIENT_SECRET,
        })
      );

      const accessToken = tokenResponse.data.access_token;

      // 2. Use the access token to authenticate the user via password grant
      const userResponse = await axios.post(
        `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          username: companyName,
          password: password,
          client_id: 'zti-client',
          client_secret: process.env.REACT_APP_CLIENT_SECRET,
          scope: 'openid',  // Request openid scope
        }),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (userResponse.data.access_token) {
        // Store the access token separately
        sessionStorage.setItem('accessToken', userResponse.data.access_token);

        // Fetch user details from Keycloak
        const userDetailsResponse = await axios.get(
          `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/userinfo`,
          {
            headers: {
              Authorization: `Bearer ${userResponse.data.access_token}`,
            },
          }
        );

        const userId = userDetailsResponse.data.sub; // Fetch the user ID

        // Store authentication details in sessionStorage (except access token)
        const loginDetails = {
          loginStatus: true,
          data: {
            companyName: companyName,
            id: userId, // Store the user ID
          },
        };

        sessionStorage.setItem('loginDetails', JSON.stringify(loginDetails));

        // Send user ID to backend for storage in MySQL (optional)
        await axios.post(`https://${hostIP}:5000/store-user-id`, { userId });

        // Redirect to home page with notification
        checkLogin(true);
        navigate('/', { replace: true, state: { notification: 'SSO Login Successful! Welcome back!' } });
      } else {
        setError('Invalid SSO credentials');
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Invalid SSO credentials');
      setLoading(false);
    }
    setLoading(false);
  };

  const renderSSOForm = () => (
    <form name="sso-login" onSubmit={handleSSOSubmit}>
      <div className={styles.formGroup}>
        <label>User Name:</label>
        <Input
          prefix={<HomeOutlined style={{ marginRight: 8 }} />}
          type="text"
          name="companyName"
          value={ssoFormData.companyName}
          onChange={handleSSOChange}
          placeholder="Enter your user name"
          required
        />
      </div>
      <div className={styles.formGroup}>
        <label>Password:</label>
        <Input.Password
          prefix={<LockOutlined style={{ marginRight: 8 }} />}
          name="password"
          value={ssoFormData.password}
          onChange={handleSSOChange}
          placeholder="Enter your password"
          required
        />
      </div>
      {error && <Alert message={error} type="error" showIcon />}
      <Button type="primary" htmlType="submit" loading={loading}>Login</Button>
    </form>
  );

  return (
    <div className={styles.App}>
      <div className="container-fluid ps-md-0">
        <div className="row g-0">
          <div className={`d-md-flex col-md-8 col-lg-6 ${styles.bgImage}`}></div>
          <div className="col-md-8 col-lg-6">
            <div className={`${styles.container} border p-4`}>
              <div className={`${styles.loginForm} text-center`}>
                <div className={styles.logoContainer}>
                  <img src={img1} alt="Logo" className={`${styles.logo} mx-auto d-block`} />
                </div>
                <h2 style={{
                  fontSize: '18px',
                  marginTop: '20px',
                  color: 'fffff',
                  textAlign: 'center'
                }}>SSO Login</h2>
                {renderSSOForm()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

