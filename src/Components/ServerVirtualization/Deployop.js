import React, { useState, useRef, useEffect } from 'react';
import { Button, Modal, Input } from 'antd';
import axios from 'axios';
import '../../Styles/DeploymentOptions.css';

const hostIP = window.location.hostname;

const DeploymentOptions = ({ onStart }) => {
  const [selectedOption, setSelectedOption] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [cloudName, setCloudName] = useState('');
  const [isDeployed, setIsDeployed] = useState(false); // NEW: track deployed state
  const [isChecking, setIsChecking] = useState(true); // NEW: disable Start until check completes
  const [okLoading, setOkLoading] = useState(false); // NEW: modal OK button loading

  const inputRef = useRef(null); // Create a reference for the input

  // Helper to get userId from sessionStorage
  const getUserId = () => {
    try {
      const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
      return loginDetails?.data?.id || null;
    } catch {
      return null;
    }
  };

    // Check on mount only (not on cloudName change)
  useEffect(() => {
    const checkHostDeployed = async () => {
      setIsChecking(true);
      const userId = getUserId();
      if (!userId) {
        setIsDeployed(false);
        setIsChecking(false);
        try { sessionStorage.setItem('sv_hostDeployed', 'false'); } catch (_) {}
        return;
      }
      try {
        const res = await axios.get(`https://${hostIP}:5000/api/host-exists`, {
          params: { userId }
        });
        setIsDeployed(res.data.exists === true);
        try { sessionStorage.setItem('sv_hostDeployed', String(res.data.exists === true)); } catch (_) {}
      } catch (err) {
        setIsDeployed(false);
        try { sessionStorage.setItem('sv_hostDeployed', 'false'); } catch (_) {}
      } finally {
        setIsChecking(false);
      }
    };
    checkHostDeployed();
  }, []);

  // Also check on modal open (when user selects Server Virtualization)
  // useEffect(() => {
  //   if (isModalVisible && cloudName) {
  //     checkHostDeployed(cloudName);
  //   }
  // }, [isModalVisible]);

  const handleOptionClick = (option) => {
    if (option === 'Server Virtualization') {
      setIsModalVisible(true);
    }
  };


  const updateMetadata = (name) => {
    let cloudNameMeta = document.querySelector('meta[name="cloud-name"]');

    if (!cloudNameMeta) {
      cloudNameMeta = document.createElement('meta');
      cloudNameMeta.name = 'cloud-name';
      document.head.appendChild(cloudNameMeta);
    }

    cloudNameMeta.content = name;
  };

  // Sync meta with session cloudName on mount (keeps UI consistent after refresh)
  useEffect(() => {
    const saved = sessionStorage.getItem('cloudName');
    if (saved) {
      updateMetadata(saved);
    }
  }, []);

  const handleModalOk = async () => {
    setOkLoading(true);
    try {
      const response = await axios.post(`https://${hostIP}:5000/check-cloud-name`, {
        cloudName,
      });

      if (response.status === 200) {
        // Persist in session and update meta so it survives refresh
        sessionStorage.setItem('cloudName', cloudName);
        // Explicitly clear any existing-deployed lock since we're starting a new flow
        try { sessionStorage.setItem('sv_hostDeployed', 'false'); } catch (_) {}
        updateMetadata(cloudName);
        onStart(cloudName);

        setIsModalVisible(false);
        setCloudName('');
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        Modal.error({
          title: 'Cloud Name Unavailable',
          content: error.response.data.message,
        });
      } else {
        console.error('Error checking cloud name:', error);
        Modal.error({
          title: 'Error',
          content: 'An error occurred while checking the cloud name. Please try again later.',
        });
      }
    } finally {
      setOkLoading(false);
    }
  };

  const handleModalCancel = () => {
    setIsModalVisible(false);
    setCloudName('');
  };

  useEffect(() => {
    if (isModalVisible && inputRef.current) {
      inputRef.current.focus(); // Focus the input programmatically
    }
  }, [isModalVisible]);

  return (
    <div>
      {/* <Breadcrumb style={{ margin: '16px 0' }}>
        <Breadcrumb.Item>
          <HomeOutlined />
        </Breadcrumb.Item>
        <Breadcrumb.Item>Deployment</Breadcrumb.Item>
      </Breadcrumb> */}
      <div>
        {/* <h4>Deployment Model</h4> */}
        <div className="options-container">
          <div
            className={`option-box ${selectedOption === 'Server Virtualization' ? 'selected' : ''}`}
          >
            {/* <h5>Server Virtualization</h5> */}
            <div className="option">
              <div
                className="option-content front"
                style={{
                  borderRadius: '8px',
                  padding: '15px',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div
                  className="option-text"
                  style={{ fontSize: '1em', color: '#333', lineHeight: '1.6' }}
                >
                  <strong>All-in-One Setup:</strong> A streamlined, self-contained cloud environment
                  where all OpenStack services are deployed on a single server, perfect for
                  development and testing.<b>(need to change def)</b>
                </div>
                <Button
                  className="custom-button"
                  type="primary"
                  disabled={isDeployed || isChecking}
                  onClick={() => {
                    if (!isDeployed && !isChecking) setIsModalVisible(true);
                  }}
                >
                  {isChecking ? 'Checking...' : (isDeployed ? 'Deployed' : 'Start')}
                </Button>
              </div>
            </div>
          </div>
          {/* <div
            className={`option-box ${selectedOption === 'Server Virtualization with HA' ? 'selected' : ''
              }`}
            onClick={() => handleOptionClick('Server Virtualization with HA')}
          > */}
          {/* <h5>Server Virtualization with HA</h5>
            <div className="option">
              <div
                className="option-content front"
                style={{
                  borderRadius: '8px',
                  padding: '15px',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div
                  className="option-text"
                  style={{ fontSize: '1em', color: '#333', lineHeight: '1.6' }}
                >
                  <strong>All-in-One Setup:</strong> A streamlined, self-contained cloud environment
                  where all OpenStack services are deployed on a single server, perfect for
                  development and testing.<b>(need to change def)</b>
                </div>

                <Button className="custom-button" type="primary" disabled>
                  Start
                </Button>
              </div> */}
          {/* </div> */}
          {/* </div> */}
          {/* <div
            className={`option-box ${selectedOption === 'Server Virtualization Scale' ? 'selected' : ''
              }`}
            onClick={() => handleOptionClick('Server Virtualization Scale')}
          > */}
          {/* <h5>Server Virtualization Scale</h5>
            <div className="option">
              <div
                className="option-content front"
                style={{
                  borderRadius: '8px',
                  padding: '15px',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div
                  className="option-text"
                  style={{ fontSize: '1em', color: '#333', lineHeight: '1.6' }}
                >
                  <strong>All-in-One Setup:</strong> A streamlined, self-contained cloud environment
                  where all OpenStack services are deployed on a single server, perfect for
                  development and testing.<b>(need to change def)</b>
                </div>
                <Button className="custom-button" type="primary" disabled>
                  Start
                </Button>
              </div>
            </div> */}
          {/* </div> */}

        </div>
      </div>

      <Modal
        title="Cloud Name"
        visible={isModalVisible}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        okButtonProps={{ disabled: !cloudName, loading: okLoading, style: { width: '80px' } }}
        cancelButtonProps={{ style: { width: '80px', marginRight: '8px' } }}
        style={{ maxWidth: '400px' }}
      >
        <Input
          ref={inputRef} // Attach the ref to the input
          placeholder="Enter your Cloud Name"
          value={cloudName}
          onChange={(e) => setCloudName(e.target.value)}
        />
      </Modal>
    </div>
  );
};

export default DeploymentOptions;

