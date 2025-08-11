import React, { useState } from "react";
import { notification, Modal, Form, Input, Button } from "antd";
import { motion } from "framer-motion";

const PasswordUpdateForm = ({ isModalVisible, setIsModalVisible }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const storedData = JSON.parse(sessionStorage.getItem("loginDetails")) || {};
  const userId = storedData?.data?.id || "";
  const userUsername = storedData?.data?.companyName || "";

  const hostIP = window.location.hostname;

  const executeScript = async (newPassword) => {
    try {
      console.log("Running script with:", { userUsername, userId, newPassword });

      const response = await fetch(`https://${hostIP}:5000/run-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userUsername,
          userId,
          newPassword: String(newPassword),
          hostIP,
        }),
      });

      if (!response.ok) {
        throw new Error("Script execution failed");
      }

      console.log("Script executed successfully!");
      return true;
    } catch (error) {
      notification.error({ message: "Error executing script", description: error.message });
      console.error("Script Error:", error);
      return false;
    }
  };

  const handleFormSubmit = async (values) => {
    const { newPassword, confirmPassword } = values;

    if (newPassword !== confirmPassword) {
      notification.error({ message: "Passwords do not match!" });
      return;
    }
    setLoading(true); // <-- start loading

    const scriptExecuted = await executeScript(newPassword);
    setLoading(false); // <-- stop loading
    if (!scriptExecuted) {
      return;
    }

    notification.success({ message: "Password updated successfully!" });
    setIsModalVisible(false);
  };

  return (
    <Modal
      title={
        <motion.h2 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          Update Password
        </motion.h2>
      }
      open={isModalVisible}
      footer={null}
      maskClosable={false}
      closable={false}
      centered
      style={{ borderRadius: "12px", overflow: "hidden" }}
    >
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}>
        <Form form={form} layout="vertical" onFinish={handleFormSubmit} style={{ padding: "10px" }}>
          <Form.Item label="Username">
            <Input value={userUsername} disabled style={{ fontWeight: "bold" }} />
          </Form.Item>
          <Form.Item label="User ID">
            <Input value={userId} disabled style={{ fontWeight: "bold" }} />
          </Form.Item>

          <Form.Item
            label="New Password"
            name="newPassword"
            rules={[
              { required: true, message: "Please enter new password" },
              { pattern: /^(?=.*[A-Z]).{8,}$/, message: "Password must be at least 8 characters long and contain at least one uppercase letter" },
            ]}
          >
            <Input.Password style={{ borderRadius: "8px" }} />
          </Form.Item>

          <Form.Item
            label="Confirm New Password"
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "Please confirm new password" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("Passwords do not match!"));
                },
              }),
            ]}
          >
            <Input.Password style={{ borderRadius: "8px" }} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} style={{ width: "100%", borderRadius: "8px", fontSize: "16px" }}>
              Update Password
            </Button>
          </Form.Item>
        </Form>
      </motion.div>
    </Modal>
  );
};

export default PasswordUpdateForm;

