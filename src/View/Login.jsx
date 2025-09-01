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
      let clientSecrets = [];
      
      // First, try to get client secret from Python backend
      try {
        const secretResponse = await axios.get(`https://${hostIP}:2020/get-client-secret`, {
          timeout: 10000
        });
        
        const { client_secret: encodedSecret, random_char_pos: randomCharPos } = secretResponse?.data || {};
        
        if (encodedSecret && randomCharPos !== undefined) {
          const clientSecret = encodedSecret.slice(0, randomCharPos) + encodedSecret.slice(randomCharPos + 1);
          clientSecrets.push({ secret: clientSecret, source: 'Python backend' });
          // console.log('Added client secret from Python backend');
        }
      } catch (err) {
        console.warn('Failed to get client secret from Python backend:', err.message);
      }
      
      // Get all client secrets from database as fallback
      try {
        const dbSecretResponse = await axios.get(`https://${hostIP}:5000/api/get-keycloak-secrets`, {
          timeout: 10000
        });
        
        if (dbSecretResponse?.data?.client_secrets && Array.isArray(dbSecretResponse.data.client_secrets)) {
          dbSecretResponse.data.client_secrets.forEach(secret => {
            clientSecrets.push({ secret: secret, source: 'database' });
          });
          // console.log(`Added ${dbSecretResponse.data.client_secrets.length} client secrets from database`);
        }
      } catch (dbErr) {
        console.warn('Failed to get client secrets from database:', dbErr.message);
      }
      
      // If no client secrets available from either source, throw error
      if (clientSecrets.length === 0) {
        throw new Error('Authentication service configuration error. Unable to retrieve client credentials. Please contact support.');
      }

      // Try each client secret until one works
      let accessToken = null;
      let successfulSecret = null;
      let lastError = null;
      
      for (let i = 0; i < clientSecrets.length; i++) {
        const { secret: clientSecret, source } = clientSecrets[i];
        // console.log(`Trying client secret ${i + 1}/${clientSecrets.length} from ${source}`);
        
        try {
          const tokenResponse = await axios.post(
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
          
          if (tokenResponse.data.access_token) {
            accessToken = tokenResponse.data.access_token;
            successfulSecret = clientSecret;
            console.log('Authentication successful');
            // console.log(`Authentication successful with client secret from ${source}`);
            break;
          }
        } catch (err) {
          console.warn(`Client secret ${i + 1} failed:`, err.response?.status || err.message);
          lastError = err;
          // Continue to next secret
        }
      }
      
      // If none of the client secrets worked, throw error
      if (!accessToken || !successfulSecret) {
        if (lastError?.response?.status === 401) {
          throw new Error('All client credentials are invalid. Authentication service may be misconfigured.');
        }
        throw new Error('Unable to authenticate with any available client credentials. Please try again later.');
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
            client_secret: successfulSecret,
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
