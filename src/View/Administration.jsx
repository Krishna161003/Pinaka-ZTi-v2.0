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
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import axios from "axios";

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
    const response = await axios.post(
      `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/token`,
      new URLSearchParams({
        client_id: "zti-client",
        client_secret: process.env.REACT_APP_CLIENT_SECRET,
        grant_type: "client_credentials",
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("Error fetching access token:", error);
    throw new Error("Failed to authenticate.");
  }
};

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
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userData, setUserData] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(true); // Loading state
  const [form] = Form.useForm();

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
    { title: "Username", dataIndex: "username", key: "username", render: (username) => (
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
          {/* <div
            style={{
              padding: 30,
              minHeight: "auto",
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            <h2>Administration</h2>
          </div> */}

          <div
            style={{
              padding: 30,
              margin: "10px 0",
              minHeight: "auto",
              background: colorBgContainer,
              // borderRadius: borderRadiusLG,
            }}
          >
            <h4>User Management</h4>
            <Divider />
            <Button
              style={{ width: "100px" }}
              type="primary"
              onClick={() => showModal()}
            >
              Create User
            </Button>

            <Button
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
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAYAAAA6/NlyAAAACXBIWXMAAAsTAAALEwEAmpwYAAADOElEQVR4nO2ayWsUQRSHP0iip2ASsrihlyiC+h/oSWO8uAUS8RaXaBAVFKOIV41iXA/+BRIxOYmIy0mEaAQP5qAoIkL0kmRwi0aIZhwpeANNUdPOdNd017T9wYNmoJY39evqeq8epKSkpKT8vywBdgHXgIfAO+Az8Bv4Jc9vgQfAVWAnsJAKox44CjwD/gC5Ek21eQIcBupwmEXAdWAmgJOFbBq4DLTgEDXAaeCHRUd1+wb0AdVxO7sKeOEz0SwwApwBtgOrRfLVYvXy2w6gX6Sc9elPvSYr4nJ2q0jONLH3siJK5qWyWNqO+6z2ZiJmOfDTMJkJ4IAl6dVIX5OGcdQuv4cI2WCYxA2goQxjKdkPFnhduomIecCYDDwjK1FueoBZzek5YBMRMR9YF/Eno83wKn0BWkkwbXJK8zqtdvcqEkyP4Z1Wp7tEc9Mg7UYSTD0wpTk9ELbTTjFX6dUc/grUBu2sSf7BKXl2EXU4+aA5rf6EQAx7OlHPrnJSc/hRkE46Dbugq9JeqgUcc6UqssmwGeQcl/aoNlcVmRWNV8q6uSrtc9o8L4SRcq4CpN2hzfFOMY0aC4RiumVcS7kAa7Q5vgwr5Zxmt8vvg5V55jQbynfSFaBxXNJulERDqfPNAM2lSNklaW8Ls0DDISRSKdIeKqbDV1ojlV10iWKlnclL+V/cDfMxjwirn9GLWsOzuIm1g1KHIY3iItaOws3aoTwrSXIXsRbsPNY6UTcCrmIlnD2oOTwuQbeLWElY1EraxOv0ftzFSkpqQHN4wvWLahvZwU+Ge6REc8ywC+4lwVQBTzWH1cXWRhJMq2T3vU7PROy0qvBZLxd5kdAuWUF9pfdFMHavp2BmTK5sI6G7QB3GoGxw5YiKbhnGU5fykbFbyg70SUzKStg4nKgVPFTgnKxWehkR0244lORNXX+ckEq8IIn1U8BHn6KWLcS4kY36hGdZ2d37pTRprci+RqxBflOR2fkiqveeAyuJmWrguM9q27BpUUzshWl6OHnJp3YriH0HrhSboomLOtlsRgIWl2Yl2XAEWECF0SLRiyoQvQe8lpLhWU/58BvgvqxkVyWWD6ekpKSkYIm/zZlJEelDnnUAAAAASUVORK5CYII="
                alt="refresh--v1"
                style={{
                  width: "20px",
                  height: "auto",
                  position: "relative", // Enable relative positioning
                  // Moves the icon slightly down
                }}
              />
            </Button>

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
            <Table
              columns={columns}
              dataSource={userData}
              rowKey="email"
              style={{ marginTop: "20px" }}
              pagination={{ pageSize: 5 }}
              loading={loading} // Add the loading state here
            />
          </div>
        </Content>
      </Layout>
    </Layout1>
  );
};

export default Administration;

