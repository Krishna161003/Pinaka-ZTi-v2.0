import Layout1 from "../Components/layout";

import React, { useState, useEffect } from "react";
import {
  theme,
  Layout,
  Divider,
  Flex,
  Select,
  Tag,
  Modal,
  Button,
  Form,
  Input,
  notification,
  Table,
  Dropdown,
  Menu,
  Row,
  Col,
  Card,
  Badge,
  Tabs,
  Switch,
  message,
} from "antd";
import { MoreOutlined, SaveOutlined } from "@ant-design/icons";
import axios from "axios";
import administration from '../Images/18_Administration.png';
import settings from '../Images/19_Settings.png';

const layout = {
  labelCol: {
    span: 8,
  },
  wrapperCol: {
    span: 16,
  },
};

// const hostIP = process.env.REACT_APP_HOST_IP || "localhost";
const hostIP = window.location.hostname;

const getAccessToken = async () => {
  try {
    let clientSecret = null;

    // First, try to get client secret from Python backend
    try {
      const secretResponse = await axios.get(`https://${hostIP}:2020/get-client-secret`);
      const { client_secret: encodedSecret, random_char_pos: randomCharPos } = secretResponse?.data || {};

      if (encodedSecret && randomCharPos !== undefined) {
        clientSecret = encodedSecret.slice(0, randomCharPos) + encodedSecret.slice(randomCharPos + 1);
        console.log('Using client secret from Python backend for Administration');
      }
    } catch (err) {
      console.warn('Failed to get client secret from Python backend in Administration:', err.message);
    }

    // If Python backend failed, try database fallback
    if (!clientSecret) {
      try {
        const dbSecretResponse = await axios.get(`https://${hostIP}:5000/api/get-keycloak-secrets`);

        if (dbSecretResponse?.data?.client_secret) {
          clientSecret = dbSecretResponse.data.client_secret;
          console.log('Using client secret from database fallback for Administration');
        }
      } catch (dbErr) {
        console.warn('Failed to get client secret from database in Administration:', dbErr.message);
      }
    }

    // If no client secret available from either source, throw error
    if (!clientSecret) {
      throw new Error('Authentication service configuration error. Unable to retrieve client credentials for Administration.');
    }

    // Use the client secret to get access token
    const response = await axios.post(
      `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
      new URLSearchParams({
        client_id: "zti-client",
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Error in authentication flow:", error);
    throw new Error("Failed to authenticate: " + (error.response?.data?.error || error.message));
  }
};

// const getAccessToken = async () => {
//   try {
//     const storedToken = sessionStorage.getItem("accessToken");
//     if (!storedToken) {
//       throw new Error("No access token found. Please log in again.");
//     }
//     return storedToken;
//   } catch (error) {
//     console.error("Error retrieving access token:", error);
//     throw new Error("Failed to authenticate.");
//   }
// };


// Function to fetch users from Keycloak
const fetchUsersFromKeycloak = async () => {
  try {
    const accessToken = await getAccessToken(); // Get the access token
    const response = await axios.get(
      `https://${hostIP}:9090/admin/realms/zti-realm/users`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.data.map((user) => ({
      ...user,
      roles: user.roles || [],
      key: user.email, // Use email as the unique key
      userId: user.id, // Directly use the built-in id
    }));
  } catch (error) {
    console.error("Error fetching users:", error);
    notification.error({
      message: "Error",
      description: "Failed to fetch users.",
    });
    return [];
  }
};

// Function to create a user in Keycloak
const createUserInKeycloak = async (user) => {
  try {
    const accessToken = await getAccessToken();
    const response = await axios.post(
      `https://${hostIP}:9090/admin/realms/zti-realm/users`,
      {
        username: user.name,
        email: user.email,
        firstName: user.name,
        lastName: user.lastname,
        enabled: true,
        emailVerified: true,
        credentials: [
          {
            type: "password",
            value: user.password,
            temporary: false,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error creating user:", error);
    throw new Error("Failed to create user.");
  }
};

const validateMessages = {
  required: "${label} is required!",
  types: {
    email: "${label} is not a valid email!",
    number: "${label} is not a valid number!",
  },
  number: {
    range: "${label} must be between ${min} and ${max}",
  },
};

const { Content } = Layout;

const Administration = () => {
  const [companyModalVisible, setCompanyModalVisible] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [integrationModalVisible, setIntegrationModalVisible] = useState(false);
  const [emailFields, setEmailFields] = useState([{ id: 1, email: '' }]);
  const [integrationFields, setIntegrationFields] = useState([
    { 
      id: 1, 
      type: 'slack',
      webhookUrl: '',
      channel: '',
      name: ''
    }
  ]);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userData, setUserData] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(true); // Loading state
  const [form] = Form.useForm();
  const [companyForm] = Form.useForm();
  const [activeSection, setActiveSection] = useState('user'); // 'user' | 'profile'

  const showModal = (user = null) => {
    setEditingUser(user);
    setIsModalOpen(true);
    if (user) {
      form.setFieldsValue(user);
    } else {
      form.resetFields();
    }
  };

  const handleCancel = () => {
    setIsModalOpen(false);
    form.resetFields();
    setEditingUser(null);
  };


  // Form submission handler (for both creating and editing users)
  const onFinish = async (values) => {
    try {
      // Create user in Keycloak
      await createUserInKeycloak(values);

      if (editingUser) {
        notification.success({
          message: "User Updated",
          description: `User ${values.name} has been updated successfully.`,
        });
      } else {
        notification.success({
          message: "User Created",
          description: (
            <>
              User <strong> {values.name}</strong> has been created
              successfully.
            </>
          ),
        });
      }

      // Re-fetch users from Keycloak after creating/updating
      const users = await fetchUsersFromKeycloak();
      setUserData(users);

      setIsModalOpen(false);
      form.resetFields();
      setEditingUser(null);
    } catch (error) {
      notification.error({
        message: "Error",
        description: "Failed to create/update user.",
      });
    }
  };

  const checkUsernameExists = async (username) => {
    try {
      const accessToken = await getAccessToken();
      const response = await axios.get(
        `https://${hostIP}:9090/admin/realms/zti-realm/users`,
        {
          params: { username },
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      // If there's any response data, it means the username already exists
      return response.data.length > 0;
    } catch (error) {
      console.error("Error checking username existence:", error);
      return false; // In case of an error, we assume the username is available
    }
  };


  const checkEmailExists = async (email) => {
    try {
      const accessToken = await getAccessToken();
      const response = await axios.get(
        `https://${hostIP}:9090/admin/realms/zti-realm/users`,
        {
          params: { email },
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      // If there's any response data, it means the email already exists
      return response.data.length > 0;
    } catch (error) {
      console.error("Error checking email existence:", error);
      return false; // In case of an error, we assume the email is available
    }
  };


  // Delete user handler
  const deleteUser = async (email) => {
    try {
      const accessToken = await getAccessToken();

      // Fetch user by email to get their ID
      const response = await axios.get(
        `https://${hostIP}:9090/admin/realms/zti-realm/users`,
        {
          params: { email },
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (response.data && response.data.length > 0) {
        const userId = response.data[0].id;
        await axios.delete(
          `https://${hostIP}:9090/admin/realms/zti-realm/users/${userId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        notification.success({
          message: "User Deleted",
          description: (
            <>
              User with email <strong>{email}</strong> has been deleted
              successfully.
            </>
          ),
        });

        // Re-fetch users from Keycloak after deleting
        const users = await fetchUsersFromKeycloak();
        setUserData(users);
      } else {
        throw new Error("User not found.");
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      notification.error({
        message: "Error",
        description: "Failed to delete user.",
      });
    }
  };

  // Dropdown menu for actions
  const actionsMenu = (record) => (
    <Menu>
      <Menu.Item key="delete" danger onClick={() => deleteUser(record.email)}>
        Delete
      </Menu.Item>
    </Menu>
  );

  // Table columns definition
  const columns = [
    {
      title: "Username", dataIndex: "username", key: "username", render: (username) => (
        <span>
          {username === "zti-admin" ? (
            <>
              {username}<b> <span style={{ color: "grey" }}>(admin)</span></b>
            </>
          ) : (
            username
          )}
        </span>
      ),
    },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "ID", dataIndex: "userId", key: "userId" }, // Use the built-in id as UserID
    {
      title: "Actions",
      key: "actions",
      render: (_, record) => (
        <Button
          danger
          size="small"
          style={{ width: "60px" }}
          onClick={() => {
            Modal.confirm({
              title: <div style={{ textAlign: "left" }}>Are you sure?</div>,
              content: (
                <div style={{ textAlign: "left" }}>
                  Do you really want to delete user <b>{record.username}</b>?
                  <br />
                  &nbsp;
                </div>
              ),
              okText: "Yes",
              cancelText: "No",
              okButtonProps: {
                style: { width: "80px", marginLeft: "10px" },
              },
              cancelButtonProps: {
                style: { width: "80px" },
              },
              bodyStyle: { textAlign: "left" },
              footer: (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    onClick={() => Modal.destroyAll()}
                    style={{ width: "80px" }}
                  >
                    No
                  </Button>
                  <Button
                    type="primary"
                    danger
                    onClick={() => {
                      deleteUser(record.email);
                      Modal.destroyAll();
                    }}
                    style={{ width: "80px", marginLeft: "10px" }}
                  >
                    Yes
                  </Button>
                </div>
              ),
            });
          }}
          disabled={record.username === "zti-admin"}
        >
          Delete
        </Button>
      ),
    },
  ];

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true); // Set loading to true before fetching
      const users = await fetchUsersFromKeycloak();
      setUserData(users);
      setLoading(false); // Set loading to false after fetching
    };
    fetchUsers();
  }, []);

  return (
    <Layout1>
      <Layout>
        <Content style={{ margin: "16px 16px" }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'nowrap' }}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={activeSection === 'user'}
              onClick={() => setActiveSection('user')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSection('user'); }}
              style={{
                padding: 30,
                minHeight: 'auto',
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                flex: 1,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                transition: 'box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <img src={administration} style={{ width: "74px", height: "74px" }} />
                <h2 style={{ margin: 0 }}>User </h2>
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={activeSection === 'profile'}
              onClick={() => setActiveSection('profile')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSection('profile'); }}
              style={{
                padding: 30,
                minHeight: 'auto',
                background: colorBgContainer,
                // borderRadius: borderRadiusLG,
                flex: 1,
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.04)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                transition: 'box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <img src={settings} style={{ width: "74px", height: "74px" }} />
                <h2 style={{ margin: 0 }}>Settings </h2>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              // borderRadius: borderRadiusLG,
            }}
          >
            {activeSection === 'user' ? (
              <>
                {/* <h3 style={{ marginTop: 0 }}>User Management</h3> */}
                {/* <Divider style={{ marginTop: 24 }} /> */}
                {/* <Button
                    style={{ width: "100px" }}
                    type="primary"
                    onClick={() => showModal()}
                    disabled
                  >
                    Create User
                  </Button> */}

                {/* <Button
                    style={{
                      width: "30px",
                      height: "30px",
                      marginLeft: "10px",
                      border: "none", // Remove border
                      padding: 0, // Optional: Remove any padding
                      background: "transparent", // Optional: Makes the background transparent
                      outline: "none", // Removes focus outline
                      top: "5px",
                    }}
                    onClick={async () => {
                      setLoading(true); // Start loading
                      const users = await fetchUsersFromKeycloak();
                      setUserData(users);
                      setLoading(false); // End loading after fetching
                    }}
                  >
                    <img
                      src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAYAAAA6/NlyAAAACXBIWXMAAAsTAAALEwEAmpwYAAADOElEQVR4nO2ayWsUQRSHP0iip2ASsrihlyiC+h/oSWO8uAUS8RaXaBAVFKOIV41iXA/+BRIxOYmIy0mEaAQP5qAoIkL0kmRwi0aIZhwpeANNUdPOdNd017T9wYNmoJY39evqeq8epKSkpKT8vywBdgHXgIfAO+Az8Bv4Jc9vgQfAVWAnsJAKox44CjwD/gC5Ek21eQIcBepwmEXAdWAmgJOFbBq4DLTgEDXAaeCHRUd1+wb0AdVxO7sKeOEz0SwwApwBtgOrRfLVYvXy2w6gX6Sc9elPvSYr4nJ2q0jONLH3siJK5qWyWNqO+6z2ZiJmOfDTMJkJ4IAl6dVIX5OGcdQuv4cI2WCYxA2goQxjKdkPFnhduomIecCYDDwjK1FueoBZzek5YBMRMR9YF/Ono83wKn0BWkkwbXJK8zqtdvcqEkyP4Z1Wp7tEc9Mg7UYSTD0wpTk9ELbTTjFX6dUc/grUBu2sSf7BKXl2EXU4+aA5rf6EQAx7OlHPrnJSc/hRkE46Dbugq9JeqgUcc6UqssmwGeQcl/aoNlcVmRWNV8q6uSrtc9o8L4SRcq4CpN2hzfFOMY0aC4RiumVcS7kAa7Q5vgwr5Zxmt8vvg5V55jQbynfSFaBxXNJulERDqfPNAM2lSNklaW8Ls0DDISRSKdIeKqbDV1ojlV10iWKlnclL+V/cDfMxjwirn9GLWsOzuIm1g1KHIY3iItaOws3aoTwrSXIXsRbsPNY6UTcCrmIlnD2oOTwuQbeLWElY1EraxOv0ftzFSkpqQHN4wvWLahvZwU+Ge6REc8ywC+4lwVQBTzWH1cXWRhJMq2T3vU7PROy0qvBZLxd5kdAuWUF9pfdFMHavp2BmTK5sI6G7QB3GoGxw5YiKbhnGU5fykbFbyg70SUzKStg4nKgVPFTgnKxWehkR0244lORNXX+ckEq8IIn1U8BHn6KWLcS4kY36hGdZ2d37pTRprci+RqxBflOR2fkiqveeAyuJmWrguM9q27BpUUzshWl6OHnJp3YriH0HrhSboomLOtlsRgIWl2Yl2XAEWECF0SLRiyoQvQe8lpLhWU/58BvgvqxkVyWWD6ekpKSkYIm/zZlJEelDnnUAAAAASUVORK5CYII="
                      alt="refresh--v1"
                      style={{
                        width: "20px",
                        height: "auto",
                        position: "relative", // Enable relative positioning
                        // Moves the icon slightly down
                      }}
                    />
                  </Button> */}

                <Table
                  columns={columns}
                  dataSource={userData}
                  rowKey="email"
                  style={{ marginTop: "20px" }}
                  pagination={{ pageSize: 5 }}
                  loading={loading} // Add the loading state here
                />
              </>
            ) : (
              <>
                {/* <h3 style={{ marginTop: 0 }}>Profile Operations</h3> */}
                <div style={{ maxWidth: '800px', margin: '0 0 0 16px', padding: '0', textAlign: 'left' }}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                    <Button
                      type="primary"
                      onClick={() => setCompanyModalVisible(true)}
                    >
                      Add Company Details
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => setEmailModalVisible(true)}
                    >
                      Add Emails and Notifications
                    </Button>
                    <Modal
                      title="Manage Notification Emails"
                      open={emailModalVisible}
                      onCancel={() => {
                        const form = document.getElementById('emailForm');
                        if (form) form.reset();
                        setEmailFields([{ id: Date.now(), email: '' }]);
                        setEmailModalVisible(false);
                      }}
                      footer={[
                        <Button 
                          key="add" 
                          onClick={() => {
                            setEmailFields([...emailFields, { id: Date.now(), email: '' }]);
                          }}
                        >
                          + Add Another Email
                        </Button>,
                        <Button key="cancel" onClick={() => {
                          setEmailModalVisible(false);
                          setEmailFields([{ id: 1, email: '' }]);
                        }}>
                          Cancel
                        </Button>,
                        <Button 
                          key="submit" 
                          type="primary" 
                          onClick={() => {
                            const form = document.getElementById('emailForm');
                            if (form) {
                              form.requestSubmit();
                            }
                          }}
                        >
                          Save Emails
                        </Button>
                      ]}
                      width={700}
                    >
                      <Form
                        id="emailForm"
                        layout="vertical"
                        onFinish={async (values) => {
                          const emails = emailFields.map((field) => ({
                            email: values[`email-${field.id}`],
                            description: values[`desc-${field.id}`] || '',
                            types: values[`types-${field.id}`] || []
                          })).filter(item => item.email);
                          
                          try {
                            // Add your API call here to save the emails
                            console.log('Emails to save:', emails);
                            // await saveEmails(emails); // Uncomment and implement your API call
                            
                            // Clear the form
                            const form = document.getElementById('emailForm');
                            if (form) form.reset();
                            setEmailFields([{ id: Date.now(), email: '' }]);
                            setEmailModalVisible(false);
                          } catch (error) {
                            console.error('Error saving emails:', error);
                            // Handle error (e.g., show error message)
                          }
                        }}
                      >
                        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
                          {emailFields.map((field, index) => (
                            <div key={field.id} style={{ 
                              marginBottom: '16px', 
                              padding: '16px', 
                              border: '1px solid #f0f0f0', 
                              borderRadius: '4px',
                              position: 'relative'
                            }}>
                              {index > 0 && (
                                <Button 
                                  type="text" 
                                  danger 
                                  size="small" 
                                  style={{ position: 'absolute', right: '8px', top: '8px' }}
                                  onClick={() => {
                                    const newFields = emailFields.filter(f => f.id !== field.id);
                                    setEmailFields(newFields);
                                  }}
                                >
                                  Remove
                                </Button>
                              )}
                              <Form.Item
                                label={`Email Address ${index + 1}`}
                                name={`email-${field.id}`}
                                rules={[
                                  { required: true, message: 'Please input email address' },
                                  { type: 'email', message: 'Please enter a valid email address' }
                                ]}
                              >
                                <Input placeholder="example@domain.com" />
                              </Form.Item>
                              <Form.Item
                                label="Description (Optional)"
                                name={`desc-${field.id}`}
                              >
                                <Input.TextArea rows={2} placeholder="e.g., Primary contact, Billing department, etc." />
                              </Form.Item>
                              <Form.Item
                                label="Notification Types"
                                name={`types-${field.id}`}
                                rules={[{ required: true, message: 'Please select at least one notification type' }]}
                              >
                                <Select mode="multiple" placeholder="Select notification types">
                                  <Select.Option value="alerts">Alerts</Select.Option>
                                  <Select.Option value="reports">Reports</Select.Option>
                                  <Select.Option value="warnings">Warnings</Select.Option>
                                  <Select.Option value="errors">Errors</Select.Option>
                                  <Select.Option value="system">System Notifications</Select.Option>
                                </Select>
                              </Form.Item>
                            </div>
                          ))}
                        </div>
                      </Form>
                    </Modal>
                    <Button
                      type="primary"
                      onClick={() => setIntegrationModalVisible(true)}
                    >
                      Add 3rd Party Integration
                    </Button>
                    <Modal
                      title="Manage 3rd Party Integrations"
                      open={integrationModalVisible}
                      onCancel={() => {
                        setIntegrationModalVisible(false);
                        setIntegrationFields([{ 
                          id: 1, 
                          type: 'slack',
                          webhookUrl: '',
                          channel: '',
                          name: ''
                        }]);
                      }}
                      footer={[
                        <Button 
                          key="add" 
                          onClick={() => {
                            setIntegrationFields([...integrationFields, { 
                              id: Date.now(), 
                              type: 'slack',
                              webhookUrl: '',
                              channel: '',
                              name: ''
                            }]);
                          }}
                        >
                          + Add Another Integration
                        </Button>,
                        <Button 
                          key="cancel" 
                          onClick={() => {
                            setIntegrationModalVisible(false);
                            setIntegrationFields([{ 
                              id: 1, 
                              type: 'slack',
                              webhookUrl: '',
                              channel: '',
                              name: ''
                            }]);
                          }}
                        >
                          Cancel
                        </Button>,
                        <Button 
                          key="submit" 
                          type="primary" 
                          onClick={() => {
                            const form = document.getElementById('integrationForm');
                            if (form) {
                              form.requestSubmit();
                            }
                          }}
                        >
                          Save Integrations
                        </Button>
                      ]}
                      width={800}
                    >
                      <Form
                        id="integrationForm"
                        layout="vertical"
                        onFinish={(values) => {
                          const integrations = integrationFields.map(field => {
                            const base = {
                              id: field.id,
                              type: values[`type-${field.id}`],
                              name: values[`name-${field.id}`] || '',
                              webhookUrl: values[`webhook-${field.id}`],
                              channel: values[`channel-${field.id}`]
                            };
                            
                            // Only include channel for Slack
                            if (base.type === 'slack') {
                              delete base.channel;
                            }
                            
                            return base;
                          }).filter(item => item.webhookUrl); // Remove empty integrations
                          
                          console.log('Integrations to save:', integrations);
                          // Add your API call here to save the integrations
                          setIntegrationModalVisible(false);
                          setIntegrationFields([{ 
                            id: 1, 
                            type: 'slack',
                            webhookUrl: '',
                            channel: '',
                            name: ''
                          }]);
                        }}
                      >
                        <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '8px' }}>
                          {integrationFields.map((field, index) => (
                            <div 
                              key={field.id} 
                              style={{ 
                                marginBottom: '16px', 
                                padding: '16px', 
                                border: '1px solid #f0f0f0', 
                                borderRadius: '4px',
                                position: 'relative'
                              }}
                            >
                              {index > 0 && (
                                <Button 
                                  type="text" 
                                  danger 
                                  size="small" 
                                  style={{ position: 'absolute', right: '8px', top: '8px' }}
                                  onClick={() => {
                                    const newFields = integrationFields.filter(f => f.id !== field.id);
                                    setIntegrationFields(newFields);
                                  }}
                                >
                                  Remove
                                </Button>
                              )}
                              
                              <Form.Item
                                label="Integration Type"
                                name={`type-${field.id}`}
                                initialValue={field.type}
                                rules={[{ required: true, message: 'Please select integration type' }]}
                              >
                                <Select 
                                  onChange={(value) => {
                                    const newFields = [...integrationFields];
                                    const fieldIndex = newFields.findIndex(f => f.id === field.id);
                                    if (fieldIndex !== -1) {
                                      newFields[fieldIndex].type = value;
                                      setIntegrationFields(newFields);
                                    }
                                  }}
                                >
                                  <Select.Option value="slack">Slack</Select.Option>
                                  <Select.Option value="teams">Microsoft Teams</Select.Option>
                                </Select>
                              </Form.Item>
                              
                              <Form.Item
                                label="Display Name"
                                name={`name-${field.id}`}
                                rules={[{ required: true, message: 'Please enter a display name' }]}
                              >
                                <Input placeholder="e.g., Dev Team Alerts, Marketing Updates" />
                              </Form.Item>
                              
                              {field.type === 'slack' && (
                                <Form.Item
                                  label="Slack Channel"
                                  name={`channel-${field.id}`}
                                  rules={[{ required: true, message: 'Please enter Slack channel name' }]}
                                >
                                  <Input placeholder="#channel-name or @username" addBefore="#" />
                                </Form.Item>
                              )}
                              
                              <Form.Item
                                label={field.type === 'slack' ? 'Slack Webhook URL' : 'Teams Webhook URL'}
                                name={`webhook-${field.id}`}
                                rules={[
                                  { required: true, message: 'Webhook URL is required' },
                                  {
                                    type: 'url',
                                    message: 'Please enter a valid URL',
                                  },
                                ]}
                              >
                                <Input 
                                  placeholder={field.type === 'slack' 
                                    ? 'https://hooks.slack.com/services/...' 
                                    : 'https://outlook.office.com/webhook/...'} 
                                />
                              </Form.Item>
                              
                              <Form.Item
                                label="Notification Types"
                                name={`notifications-${field.id}`}
                              >
                                <Select mode="multiple" placeholder="Select notification types">
                                  <Select.Option value="alerts">Alerts</Select.Option>
                                  <Select.Option value="reports">Reports</Select.Option>
                                  <Select.Option value="warnings">Warnings</Select.Option>
                                  <Select.Option value="errors">Errors</Select.Option>
                                </Select>
                              </Form.Item>
                            </div>
                          ))}
                        </div>
                      </Form>
                    </Modal>
                  </div>

                  <Modal
                    title="Company Details"
                    open={companyModalVisible}
                    onCancel={() => {
                      companyForm.resetFields();
                      setCompanyModalVisible(false);
                    }}
                    footer={[
                      <Button 
                        key="cancel" 
                        onClick={() => {
                          companyForm.resetFields();
                          setCompanyModalVisible(false);
                        }}
                      >
                        Cancel
                      </Button>,
                      <Button 
                        key="submit" 
                        type="primary" 
                        onClick={() => {
                          companyForm.submit();
                        }}
                      >
                        Save
                      </Button>
                    ]}
                    width={800}
                  >
                    <Card
                      style={{
                        boxShadow: 'none',
                        borderRadius: '8px',
                      }}
                    >
                      <Form
                        form={companyForm}
                        name="company_details"
                        layout="vertical"
                        autoComplete="off"
                        style={{ padding: '0 8px' }}
                        onFinish={async (values) => {
                          try {
                            const res = await fetch(`https://${hostIP}:5000/api/company`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(values),
                            });
                            const data = await res.json();
                            console.log(data);
                            message.success(data.message || "Company details saved successfully!");
                            companyForm.resetFields();
                            setCompanyModalVisible(false);
                          } catch (error) {
                            console.error('Error saving company details:', error);
                            message.error("Failed to save company details");
                          }
                        }}
                      >
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="Company Name"
                              name="companyName"
                              rules={[
                                { required: true, message: 'Please input company name!' },
                                { min: 2, message: 'Company name is too short (minimum 2 characters)' },
                                { max: 100, message: 'Company name is too long (maximum 100 characters)' }
                              ]}
                            >
                              <Input placeholder="Enter company name" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="PAN"
                              name="pan"
                              rules={[
                                { required: true, message: 'Please input PAN number!' },
                                {
                                  pattern: /^[A-Za-z0-9]{10}$/,
                                  message: 'PAN must be 10 alphanumeric characters'
                                }
                              ]}
                            >
                              <Input
                                placeholder="Enter PAN number"
                                style={{ textTransform: 'uppercase' }}
                                maxLength={10}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item
                          label="Registered Address"
                          name="address"
                          rules={[
                            { required: true, message: 'Please input registered address!' },
                            { min: 10, message: 'Address must be at least 10 characters long' },
                            { max: 500, message: 'Address cannot exceed 500 characters' }
                          ]}
                        >
                          <Input
                            placeholder="Enter registered address"
                            showCount
                            maxLength={500}
                          />
                        </Form.Item>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="GSTIN/VAT ID"
                              name="gstin"
                              rules={[
                                { required: true, message: 'Please input GSTIN/VAT ID!' },
                                {
                                  pattern: /^[0-9A-Za-z]{15}$/,
                                  message: 'GSTIN must be 15 alphanumeric characters'
                                }
                              ]}
                            >
                              <Input
                                placeholder="Enter 15-digit GSTIN"
                                style={{ textTransform: 'uppercase' }}
                                maxLength={15}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="Contact Person"
                              name="contactPerson"
                              rules={[
                                { required: true, message: 'Please input contact person name!' },
                                { min: 2, message: 'Name is too short (minimum 2 characters)' },
                                { max: 100, message: 'Name is too long (maximum 100 characters)' }
                              ]}
                            >
                              <Input placeholder="Enter contact person name" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              label="Phone Number"
                              name="phone"
                              rules={[
                                { required: true, message: 'Please input phone number!' },
                                {
                                  pattern: /^[0-9]{10}$/,
                                  message: 'Please enter a valid 10-digit phone number'
                                }
                              ]}
                            >
                              <Input
                                placeholder="Enter phone number"
                                maxLength={10}
                                type="tel"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label="Email ID"
                              name="email"
                              rules={[
                                { required: true, message: 'Please input email address' },
                                {
                                  type: 'email',
                                  message: 'Please enter a valid email address'
                                }
                              ]}
                            >
                              <Input
                                placeholder="Enter email address"
                                type="email"
                              />
                            </Form.Item>
                          </Col>
                        </Row>
  
                      </Form>
                    </Card>
                  </Modal>
                </div>
              </>
            )}

            <Modal
              title={<div style={{ marginBottom: "20px" }}>User Details</div>}
              open={isModalOpen}
              footer={[
                <Button
                  key="cancel"
                  onClick={handleCancel}
                  style={{ width: "auto" }}
                >
                  Cancel
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  htmlType="submit"
                  form="userForm"
                  style={{ width: "auto" }}
                >
                  {editingUser ? "Update" : "Create"}
                </Button>,
              ]}
              onCancel={handleCancel}
              closable={false}
              style={{ width: "100%" }}
            >
              <Form
                form={form}
                {...layout}
                name="nest-messages"
                onFinish={onFinish}
                style={{
                  maxWidth: 600,
                  margin: "0 auto",
                }}
                validateMessages={validateMessages}
                labelAlign="left"
                id="userForm"
              >
                <Form.Item
                  name="name"
                  label="First Name/Username"
                  rules={[
                    { required: true, message: "Username is required!" },
                    {
                      min: 3,
                      message: "Username must be at least 3 characters long!",
                    },
                    {
                      async validator(_, value) {
                        if (value) {
                          const exists = await checkUsernameExists(value);
                          if (exists) {
                            return Promise.reject(new Error("Username already exists!"));
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                  validateTrigger="submit"
                >
                  <Input placeholder="Enter your first name or username" />
                </Form.Item>


                <Form.Item
                  name="lastname"
                  label="Last Name"
                  rules={[{ required: true }]}
                  validateTrigger="submit"
                >
                  <Input placeholder="Enter your last name" />
                </Form.Item>

                <Form.Item
                  name="email"
                  label="Email"
                  rules={[
                    { type: "email", required: true, message: "Please enter a valid email!" },
                    {
                      async validator(_, value) {
                        if (value) {
                          const exists = await checkEmailExists(value);
                          if (exists) {
                            return Promise.reject(new Error("Email already exists!"));
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                  validateTrigger="submit"
                >
                  <Input placeholder="Enter your email address" />
                </Form.Item>


                <Form.Item
                  name="password"
                  label="Password"
                  rules={[
                    { required: true, message: "Please input your password!" },
                  ]}
                  hasFeedback
                  validateTrigger="submit"
                >
                  <Input.Password placeholder="Enter your password" />
                </Form.Item>

                <Form.Item
                  name="confirm"
                  label="Confirm Password"
                  dependencies={["password"]}
                  hasFeedback
                  rules={[
                    {
                      required: true,
                      message: "Please confirm your password!",
                    },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue("password") === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(
                          new Error("The password does not match!")
                        );
                      },
                    }),
                  ]}
                  validateTrigger="submit"
                >
                  <Input.Password placeholder="Re-enter your password" />
                </Form.Item>

                {/* Add the Select for roles here */}
                <Form.Item
                  name="tags"
                  label="Select Roles"
                  rules={[
                    {
                      required: true,
                      message: "Please select at least one Role",
                    },
                  ]}
                  validateTrigger="submit"
                >
                  <Select
                    mode="multiple"
                    placeholder="Select Roles"
                    style={{ width: "100%" }}
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <Flex
                          gap="4px 0"
                          wrap
                          style={{
                            padding: "8px",
                            borderTop: "1px solid #e8e8e8",
                            background: "#fafafa",
                          }}
                        ></Flex>
                      </>
                    )}
                  >
                    <Select.Option value="Admin">Admin</Select.Option>
                    <Select.Option value="VDI_Admin">VDI Admin</Select.Option>
                    <Select.Option value="AI_Admin">AI Admin</Select.Option>
                    <Select.Option value="HPC_Admin">HPC Admin</Select.Option>
                  </Select>
                </Form.Item>
              </Form>
            </Modal>
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Administration;