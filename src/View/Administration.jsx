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
  const [activeTab, setActiveTab] = useState("1");

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
                  </div>

                  <Modal
                    title="Company Details"
                    open={companyModalVisible}
                    onCancel={() => {
                      companyForm.resetFields();
                      setCompanyModalVisible(false);
                      setActiveTab("1");
                    }}
                    footer={[
                      <Button
                        key="previous"
                        onClick={() => setActiveTab((prev) => String(Number(prev) - 1))}
                        disabled={activeTab === "1"}
                      >
                        Previous
                      </Button>,
                      <Button
                        key="cancel"
                        onClick={() => {
                          companyForm.resetFields();
                          setCompanyModalVisible(false);
                          setActiveTab("1");
                        }}
                      >
                        Cancel
                      </Button>,
                      <Button
                        key="next"
                        type="primary"
                        onClick={async () => {
                          try {
                            if (activeTab === "1") {
                              await companyForm.validateFields([
                                "companyName",
                                "pan",
                                "address",
                                "gstin",
                                "contactPerson",
                                "phone",
                                "email",
                              ]);
                            } else if (activeTab === "2") {
                              await companyForm.validateFields(["emails"]);
                            } else if (activeTab === "3") {
                              await companyForm.validateFields(["slack_integrations", "teams_integrations"]);
                            }
                            setActiveTab((prev) => String(Number(prev) + 1));
                          } catch (err) {
                            console.log("Validation failed:", err);
                          }
                        }}
                        disabled={activeTab === "3"}
                      >
                        Next
                      </Button>,
                      <Button
                        key="save"
                        type="primary"
                        onClick={async () => {
                          try {
                            await companyForm.validateFields();
                            companyForm.submit();
                          } catch (err) {
                            console.log("Save blocked, validation failed:", err);
                          }
                        }}
                      >
                        Save
                      </Button>,
                    ]}
                    width={800}
                  >
                    {/* ✅ Single Form wrapping all tabs */}
                    <Form
                      form={companyForm}
                      name="company_details"
                      layout="vertical"
                      autoComplete="off"
                      onFinish={async (values) => {
                        try {
                          const payload = {
                            company_name: values.companyName,
                            pan_number: values.pan,
                            gst_number: values.gstin,
                            address: values.address,
                            contact_person: values.contactPerson,
                            phone_number: values.phone,
                            email_id: values.email,
                            notification_emails: values.emails || [],
                            notification_description: values.description || null,
                            integrations: [
                              ...(values.slack_integrations || []).map((s) => ({ type: "Slack", ...s })),
                              ...(values.teams_integrations || []).map((t) => ({ type: "Teams", ...t })),
                            ],
                          };

                          const res = await fetch(`https://${hostIP}:5000/api/company`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                          });

                          const data = await res.json();
                          if (res.ok) {
                            message.success(data.message || "Company details saved successfully!");
                            companyForm.resetFields();
                            setCompanyModalVisible(false);
                            setActiveTab("1");
                          } else {
                            message.error(data.error || "Failed to save company details");
                          }
                        } catch (error) {
                          console.error("Error saving company details:", error);
                          message.error("Failed to save company details");
                        }
                      }}
                    >
                      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key)} style={{ marginTop: -16 }}>
                        {/* TAB 1: Company Details */}
                        <Tabs.TabPane tab="Company Details" key="1">
                          <Row gutter={16}>
                            {/* Company Name */}
                            <Col span={12}>
                              <Form.Item
                                label="Company Name"
                                name="companyName"
                                rules={[
                                  { required: true, message: "Company name is required" },
                                  { min: 3, message: "Company name must be at least 3 characters" },
                                  {
                                    pattern: /^[A-Za-z0-9\s\.\,&'-]+$/,
                                    message: "Company name can contain letters, numbers, spaces, and basic symbols",
                                  },
                                ]}
                              >
                                <Input placeholder="Enter company name" />
                              </Form.Item>
                            </Col>

                            {/* PAN Number */}
                            <Col span={12}>
                              <Form.Item
                                label="PAN Number"
                                name="pan"
                                rules={[
                                  { required: true, message: "PAN number is required" },
                                  {
                                    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
                                    message: "Enter a valid PAN number (e.g., ABCDE1234F)",
                                  },
                                ]}
                              >
                                <Input
                                  placeholder="Enter PAN number"
                                  maxLength={10}
                                  onChange={(e) => {
                                    e.target.value = e.target.value.toUpperCase().replace(/\s/g, "");
                                  }}
                                />
                              </Form.Item>
                            </Col>
                          </Row>

                          <Row gutter={16}>
                            {/* Address */}
                            <Col span={24}>
                              <Form.Item
                                label="Address"
                                name="address"
                                rules={[
                                  { required: true, message: "Address is required" },
                                  { min: 5, message: "Address must be at least 5 characters" },
                                ]}
                              >
                                <Input.TextArea placeholder="Enter address" autoSize={{ minRows: 2, maxRows: 4 }} />
                              </Form.Item>
                            </Col>
                          </Row>

                          <Row gutter={16}>
                            {/* GST Number */}
                            <Col span={12}>
                              <Form.Item
                                label="GST Number"
                                name="gstin"
                                rules={[
                                  { required: true, message: "GST number is required" },
                                  {
                                    len: 15,
                                    message: "GST number must be exactly 15 characters",
                                  },
                                ]}
                              >
                                <Input
                                  placeholder="Enter GST number"
                                  maxLength={15}
                                  onChange={(e) => {
                                    e.target.value = e.target.value.toUpperCase().replace(/\s/g, "");
                                  }}
                                />
                              </Form.Item>
                            </Col>

                            {/* Contact Person */}
                            <Col span={12}>
                              <Form.Item
                                label="Contact Person"
                                name="contactPerson"
                                rules={[
                                  { required: true, message: "Contact person is required" },
                                  {
                                    pattern: /^[A-Za-z\s]+$/,
                                    message: "Only alphabets and spaces are allowed",
                                  },
                                  { min: 3, message: "Contact person must be at least 3 characters" },
                                ]}
                              >
                                <Input placeholder="Enter contact person" />
                              </Form.Item>
                            </Col>
                          </Row>

                          <Row gutter={16}>
                            {/* Phone Number */}
                            <Col span={12}>
                              <Form.Item
                                label="Phone Number"
                                name="phone"
                                rules={[
                                  { required: true, message: "Phone number is required" },
                                  {
                                    pattern: /^[6-9][0-9]{9}$/,
                                    message: "Enter a valid 10-digit Indian phone number",
                                  },
                                ]}
                              >
                                <Input placeholder="Enter phone number" maxLength={10} />
                              </Form.Item>
                            </Col>

                            {/* Email */}
                            <Col span={12}>
                              <Form.Item
                                label="Email ID"
                                name="email"
                                rules={[
                                  { required: true, message: "Email is required" },
                                  { type: "email", message: "Enter a valid email" },
                                ]}
                              >
                                <Input placeholder="Enter email ID" />
                              </Form.Item>
                            </Col>
                          </Row>
                        </Tabs.TabPane>



                        {/* TAB 2: Emails & Notifications */}
                        <Tabs.TabPane tab="Add Emails and Notifications" key="2">
                          <Form.List name="emails" initialValue={[""]}>
                            {(fields, { add, remove }) => (
                              <>
                                {fields.map(({ key, name }) => (
                                  <Form.Item
                                    key={key}
                                    label="Email ID"
                                    name={name}
                                    rules={[
                                      { required: true, message: "Email is required" },
                                      { type: "email", message: "Enter a valid email" },
                                    ]}
                                  >
                                    <Input
                                      placeholder="Enter email"
                                      addonAfter={
                                        fields.length > 1 && (
                                          <a onClick={() => remove(name)} style={{ color: "red" }}>
                                            Remove
                                          </a>
                                        )
                                      }
                                    />
                                  </Form.Item>
                                ))}
                                <Form.Item style={{ marginTop: -10 }}>
                                  <Button type="default" onClick={() => add()}>+ Add another email</Button>
                                </Form.Item>
                              </>
                            )}
                          </Form.List>

                          <Form.Item label="Description" name="description">
                            <Input placeholder="Enter description (optional)" />
                          </Form.Item>
                        </Tabs.TabPane>

                        {/* TAB 3: Integrations */}
                        <Tabs.TabPane tab="Add 3rd Party Integrations" key="3">
                          <h6>Slack Integrations</h6>
                          <Form.List name="slack_integrations" initialValue={[{}]}>
                            {(fields, { add, remove }) => (
                              <>
                                {fields.map(({ key, name }, index) => (
                                  <div key={key} style={{ marginBottom: 12 }}>
                                    <Form.Item
                                      name={[name, "workspace"]}
                                      label="Workspace URL"
                                      rules={[{ required: true, message: "Workspace URL is required" }]}
                                    >
                                      <Input placeholder="Enter workspace URL" />
                                    </Form.Item>
                                    <Form.Item
                                      name={[name, "channel"]}
                                      label="Channel / Webhook"
                                      rules={[{ required: true, message: "Channel/Webhook is required" }]}
                                    >
                                      <Input placeholder="Enter channel/webhook" />
                                    </Form.Item>
                                    {index > 0 && (
                                      <a onClick={() => remove(name)} style={{ color: "red" }}>
                                        Remove Slack Integration
                                      </a>
                                    )}
                                  </div>
                                ))}
                                <Form.Item style={{ marginTop: -10 }}>
                                  <Button type="default" onClick={() => add()}>+ Add another Slack integration</Button>
                                </Form.Item>
                              </>
                            )}
                          </Form.List>

                          <h6>Teams Integrations</h6>
                          <Form.List name="teams_integrations" initialValue={[{}]}>
                            {(fields, { add, remove }) => (
                              <>
                                {fields.map(({ key, name }, index) => (
                                  <div key={key} style={{ marginBottom: 12 }}>
                                    <Form.Item
                                      name={[name, "webhook"]}
                                      label="Webhook URL"
                                      rules={[{ required: true, message: "Webhook URL is required" }]}
                                    >
                                      <Input placeholder="Enter webhook URL" />
                                    </Form.Item>
                                    <Form.Item name={[name, "channel"]} label="Channel (Optional)">
                                      <Input placeholder="Enter channel" />
                                    </Form.Item>
                                    {index > 0 && (
                                      <a onClick={() => remove(name)} style={{ color: "red" }}>
                                        Remove Teams Integration
                                      </a>
                                    )}
                                  </div>
                                ))}
                                <Form.Item style={{ marginTop: -10 }}>
                                  <Button type="default" onClick={() => add()}>+ Add another Teams integration</Button>
                                </Form.Item>
                              </>
                            )}
                          </Form.List>
                        </Tabs.TabPane>
                      </Tabs>
                    </Form>
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