import React from "react";
import { Typography, Card, Table, List, Space, Divider, Tag } from "antd";
import { CheckOutlined, CloseOutlined, PhoneOutlined, MailOutlined, LinkOutlined } from "@ant-design/icons";

const Support = () => {
  const { Title, Paragraph, Text } = Typography;

  const Tick = () => <CheckOutlined style={{ color: "#2e7d32" }} />;
  const Cross = () => <CloseOutlined style={{ color: "#d32f2f" }} />;

  // Table 1: Software SLAs & Hardware/RMA replacement SLAs (software part)
  const slaColumns = [
    { title: "SLA Level", dataIndex: "level", key: "level", width: 180 },
    { title: "Description", dataIndex: "description", key: "description", width: 180 },
    { title: "Example", dataIndex: "example", key: "example" },
    { title: "Response Time", dataIndex: "response", key: "response", width: 200 },
  ];

  // Hardware/RMA replacement SLAs table (to match screenshot)
  const hardwareColumns = [
    {
      dataIndex: "label",
      key: "label",
      width: 320,
      render: (value, row, index) => {
        if (index === 2) {
          // Hide left cell for the full-width final row
          return { children: null, props: { colSpan: 0 } };
        }
        return value;
      },
    },
    {
      dataIndex: "content",
      key: "content",
      render: (value, row, index) => {
        if (index === 2) {
          return {
            children: (
              <Text strong>
                Any one of the below valid AMC packages can be opted for including the hardware support.
              </Text>
            ),
            props: { colSpan: 2 },
          };
        }
        return value;
      },
    },
  ];

  const hardwareData = [
    {
      key: "hw-1",
      label: (
        <Text strong>
          Description — OEM warranty applicable and hardware replacement terms
        </Text>
      ),
      content: (
        <>
          <Text strong>E.g. memory failure, cable failures, connection failures</Text>
          <br />Response time: 7–10 business days
        </>
      ),
    },
    {
      key: "hw-2",
      label: "",
      content: (
        <ul style={{ paddingLeft: 16, margin: 0 }}>
          <li>1st year support & warranty without additional charges.</li>
          <li>
            2nd year onwards, hardware support will be applicable only if a valid AMC contract is in place and the
            hardware was supplied by Pinakastra.
          </li>
        </ul>
      ),
    },
    {
      key: "hw-3",
      label: "",
      content: null, // content rendered via colSpan in columns render
    },
  ];

  const levelTag = (label, bg, color = "#fff") => (
    <Tag style={{ backgroundColor: bg, color, border: "none", fontWeight: 600 }}>{label}</Tag>
  );

  const slaData = [
    {
      key: "p1",
      level: levelTag("P1 • Critical", "#d32f2f"),
      description: <Text strong>Business Critical</Text>,
      example: (
        <ul style={{ paddingLeft: 16 }}>
          <li>Critical apps are down/not accessible.</li>
          <li>Alarms and alerting services are down.</li>
          <li>Need a workaround in the least amount of time.</li>
        </ul>
      ),
      response: <Text strong>30 minutes or fewer</Text>,
    },
    {
      key: "p2",
      level: levelTag("P2 • High", "#fbc02d", "#111"),
      description: <Text strong>Major Issue</Text>,
      example: (
        <ul style={{ paddingLeft: 16 }}>
          <li>User logins are working intermittently with the console and workloads.</li>
          <li>Slow application performance impacting important business activities.</li>
        </ul>
      ),
      response: <Text strong>2 hours or fewer</Text>,
    },
    {
      key: "p3",
      level: levelTag("P3 • Medium", "#1976d2"),
      description: <Text strong>Minor Issue</Text>,
      example: (
        <ul style={{ paddingLeft: 16 }}>
          <li>Trouble creating a new workload.</li>
          <li>Misunderstanding of functionality.</li>
        </ul>
      ),
      response: <Text strong>4 hours or fewer</Text>,
    },
    {
      key: "p4",
      level: levelTag("P4 • Low", "#388e3c"),
      description: <Text strong>Cosmetic Issue</Text>,
      example: (
        <ul style={{ paddingLeft: 16 }}>
          <li>User interface look and feel issues, workflow questions.</li>
        </ul>
      ),
      response: <Text strong>8 hours or fewer</Text>,
    },
  ];

  // Table 2: AMC Packages
  const amcColumns = [
    { title: "Activity", dataIndex: "activity", key: "activity", width: 220 },
    { title: "Description", dataIndex: "description", key: "description" },
    {
      title: <Text style={{ color: "gold", fontWeight: 700 }}>GOLD 🥇</Text>,
      dataIndex: "gold",
      key: "gold",
      align: "center",
      width: 140,
    },
    {
      title: <Text style={{ color: "silver", fontWeight: 700 }}>SILVER 🥈</Text>,
      dataIndex: "silver",
      key: "silver",
      align: "center",
      width: 140,
    },
    {
      title: <Text style={{ color: "#cd7f32", fontWeight: 700 }}>BRONZE 🥉</Text>,
      dataIndex: "bronze",
      key: "bronze",
      align: "center",
      width: 140,
    },
  ];

  const amcData = [
    {
      key: "install-config",
      activity: "Installing and configuring",
      description:
        "Install and configure Pinakastra components, such as Keystone, Glance, Nova, Neutron, and Horizon.",
      gold: <Tick />, silver: <Tick />, bronze: <Tick />,
    },
    {
      key: "users-tenants",
      activity: "Managing users and tenants",
      description:
        "Manage user accounts and tenants, assign roles and permissions, and ensure users have necessary access.",
      gold: <Tick />, silver: <Tick />, bronze: <Tick />,
    },
    {
      key: "network-storage",
      activity: "Managing network and storage",
      description: "Configure and manage the network and storage resources used by Pinakastra instances.",
      gold: <Tick />, silver: <Tick />, bronze: <Cross />,
    },
    {
      key: "compute",
      activity: "Managing compute resources",
      description:
        "Manage the compute resources used by Pinakastra instances, such as hypervisors and virtual machine instances.",
      gold: <Tick />, silver: <Tick />, bronze: <Cross />,
    },
    {
      key: "monitor-troubleshoot",
      activity: "Monitoring and troubleshooting",
      description:
        "Monitor the Pinakastra environment for issues or performance problems; troubleshoot and resolve problems.",
      gold: <Tick />, silver: <Tick />, bronze: <Cross />,
    },
    {
      key: "upgrade-patch",
      activity: "Upgrading and patching",
      description:
        "Upgrade and patch the Pinakastra environment to ensure it is up-to-date with the latest security patches.",
      gold: <Tick />, silver: <Cross />, bronze: <Cross />,
    },
    {
      key: "backup-dr",
      activity: "Backup and disaster recovery",
      description:
        "Plan and implement backup and disaster recovery strategies to ensure data is protected and can be restored.",
      gold: <Tick />, silver: <Cross />, bronze: <Cross />,
    },
    {
      key: "capacity",
      activity: "Capacity planning",
      description:
        "Monitor the usage of resources in the Pinakastra environment and plan for future capacity needs.",
      gold: <Tick />, silver: <Cross />, bronze: <Cross />,
    },
    {
      key: "security",
      activity: "Security and compliance",
      description:
        "Ensure the Pinakastra environment is secure and compliant with relevant regulations and standards.",
      gold: <Tick />, silver: <Cross />, bronze: <Cross />,
    },
    {
      key: "docs-report",
      activity: "Documentation and reporting",
      description:
        "Document the Pinakastra environment (excluding Pinakastra IP), including configuration, policies, procedures, and prepare reports.",
      gold: <Tick />, silver: <Tick />, bronze: <Cross />,
    },
    {
      key: "hardware-support",
      activity: "Hardware support",
      description: (
        <>
          OEM warranty applicable and hardware replacement terms
          <ul style={{ paddingLeft: 16, marginTop: 6 }}>
            <li>
              Hardware replacement charges to be borne by the customer based on OEM invoice actual charges.
            </li>
            <li>Travel charges for the customer engineer are to be borne by the customer.</li>
          </ul>
        </>
      ),
      gold: <Tick />, silver: <Tick />, bronze: <Cross />,
    },
    {
      key: "charges",
      activity: "AMC Charges",
      description: "",
      gold: <Text style={{ color: "gold", fontWeight: 700 }}>15% of PO value</Text>,
      silver: <Text style={{ color: "silver", fontWeight: 700 }}>10% of PO value</Text>,
      bronze: <Text style={{ color: "#cd7f32", fontWeight: 700 }}>5% of PO value</Text>,
    },
  ];

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      {/* <Typography style={{ textAlign: "center", marginTop: 8 }}>
        <Title level={2} style={{ color: "#007bff", marginBottom: 0 }}>--- Support Details ---</Title>
      </Typography> */}

      <Card style={{ width: "100%", maxWidth: 1100, marginTop: 16 }} bodyStyle={{ padding: 20 }}>
        <Title level={2} style={{ marginTop: 0 }}>Pinakastra AMC & SLAs</Title>
        <Paragraph>
          We know customers have varied preferences in engaging support resources – find yours below.
        </Paragraph>

        <List
          itemLayout="horizontal"
          dataSource={[
            {
              icon: <LinkOutlined />,
              content: (
                <>
                  To register support cases, please use this URL: {" "}
                  <a href="https://pinakastra.freshdesk.com" target="_blank" rel="noreferrer">Pinakastra Support</a>
                </>
              ),
            },
            {
              icon: <MailOutlined />,
              content: (
                <>
                  Contact us via email at {" "}
                  <a href="mailto:support@pinakastra.com">support@pinakastra.com</a> to get rapid resolution to your inquiries.
                </>
              ),
            },
            {
              icon: <CheckOutlined />,
              content: (
                <>
                  Our support team is available <Text strong>24 × 7 × 365</Text>.
                </>
              ),
            },
            {
              icon: <PhoneOutlined />,
              content: (
                <>
                  Please call us at <a href="tel:+919008488882">+91 9008488882</a> and ask to be connected to our support team – they will be glad to address your issues and inquiries.
                </>
              ),
            },
          ]}
          renderItem={(item) => (
            <List.Item>
              <Space>
                {item.icon}
                <span>{item.content}</span>
              </Space>
            </List.Item>
          )}
        />

        <Paragraph>
          When needed, Pinakastra offers software SLAs and an aggressive hardware RMA process to address the most demanding uptime requirements.
          See our offerings in tables below.
        </Paragraph>

        <Divider orientation="left">Table 1: Software SLAs</Divider>
        <Table
          columns={slaColumns}
          dataSource={slaData}
          pagination={false}
          bordered
          size="middle"
        />

        <Paragraph style={{ marginTop: 16 }}>
          (Pinakastra hardware support is offered to all customers who purchased their Pinakastra private cloud appliance from Pinakastra Computing. If you purchased your Pinakastra private cloud appliance from Pinakastra, please engage Pinakastra for support. Otherwise, please contact your own hardware vendor for support).
        </Paragraph>

        <Divider orientation="left">Hardware/RMA replacement SLAs</Divider>
        <Table
          columns={hardwareColumns}
          dataSource={hardwareData}
          pagination={false}
          bordered
          size="middle"
          showHeader={false}
        />

        <Divider orientation="left">Table 2: AMC Packages</Divider>
        <Table
          columns={amcColumns}
          dataSource={amcData}
          pagination={false}
          bordered
          size="middle"
        />
      </Card>
    </div>
  );
};

export default Support;