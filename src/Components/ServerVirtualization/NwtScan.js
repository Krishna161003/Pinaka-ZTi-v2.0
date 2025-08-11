import React, { useRef, useState, useEffect } from "react";
import {
  Divider,
  Table,
  Button,
  Breadcrumb,
  notification
} from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { CloudOutlined } from "@ant-design/icons";


const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null; // Return the content of the meta tag
};

const hostIP = window.location.hostname;


const DataTable = ({ onNodeSelect, next }) => {
  const cloudName = getCloudName();
  const [isScanning, setIsScanning] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [numberOfSockets, setNumberOfSockets] = useState(0);
  const [copyStatus, setCopyStatus] = useState("Copy Details");
  const itemsPerPage = 4;
  const [api, contextHolder] = notification.useNotification();

  const fetchData = async () => {
    try {
      setIsScanning(true);
      const res = await fetch(`https://${hostIP}:2020/get-interfaces`);
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      setNumberOfSockets(data.cpu_sockets);
      const formattedNodes = data.interfaces.map((iface, index) => ({
        key: `${iface.iface}-${iface.mac}-${index}`, // guarantees uniqueness
        interface: iface.iface,
        mac: iface.mac,
        ip: iface.ip,
      }));

      setNodes(formattedNodes);
    } catch (error) {
      console.error(error);
      api.error({
        message: "Data Fetch Error",
        description:
          error.message || "Something went wrong while fetching the data",
      });
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCopyDetails = () => {
    const licensesRequired = numberOfSockets;
    const socketInfo = `Number of Sockets: ${numberOfSockets || 2}`;
    const licenseInfo = `License Required: ${licensesRequired || 2}`;

    const tableData = nodes
      .map((node, index) =>
        `${index + 1}. ${columns
          .map((col) => `${col.title}: ${node[col.dataIndex]}`)
          .join(", ")}`
      )
      .join("\n");

    const textToCopy = `${socketInfo}\n${licenseInfo}\n\n${tableData}`;

    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopyStatus("Copied");
        setTimeout(() => setCopyStatus("Copy Details"), 1000);
      })
      .catch(() => {
        setCopyStatus("Failed");
        setTimeout(() => setCopyStatus("Copy Details"), 1000);
      });
  };

  const columns = [
    {
      title: "Interface",
      dataIndex: "interface",
      key: "interface",
    },
    {
      title: "MAC Address",
      dataIndex: "mac",
      key: "mac",
    },
    {
      title: "IP Address",
      dataIndex: "ip",
      key: "ip",
    },
  ];

  return (
    <div style={{ padding: "20px" }}>
      {contextHolder}
      {/* Flex container to align Breadcrumb and Button in same row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          // alignItems: "center",
          // marginBottom: "16px",
        }}
      >
        {/* <Breadcrumb>
          <Breadcrumb.Item>
            <HomeOutlined />
          </Breadcrumb.Item>
          <Breadcrumb.Item>Deployment Options</Breadcrumb.Item>
          <Breadcrumb.Item>Validation</Breadcrumb.Item>
          <Breadcrumb.Item>System Interface</Breadcrumb.Item>
        </Breadcrumb> */}
        <h4 style={{marginBottom: "-16px", marginTop: "3px"}}>
          Cloud Name: <span style={{ color: "blue" }}>{cloudName}</span>
        </h4>
        <Button
          size="middle"
          style={{ width: "75px" }}
          type="primary"
          onClick={next}
        >
          Next
        </Button>
      </div>

      <Divider style={{ marginBottom: "18px",marginTop: "28px" }} />
      <div style={{ display: "flex", gap: "40px", marginBottom: "16px", marginLeft: "3px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Number of Sockets:</span>
          <div style={{
            border: "1px solid #d9d9d9",
            borderRadius: "4px",
            padding: "4px 12px",
            minWidth: "40px",
            textAlign: "center",
            backgroundColor: "#fafafa",
          }}>
            {numberOfSockets}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>License Required:</span>
          <div style={{
            border: "1px solid #d9d9d9",
            borderRadius: "4px",
            padding: "4px 12px",
            minWidth: "40px",
            textAlign: "center",
            backgroundColor: "#fafafa",
          }}>
            {numberOfSockets}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            size="middle"
            style={{ width: "95px" }}
            type="primary"
            onClick={handleCopyDetails}
          >
            {copyStatus}
          </Button>
          <Button
            size="middle"
            style={{ width: "95px" }}
            color="primary"
            variant="outlined"
            onClick={fetchData}
          >
            Refresh
          </Button>
        </div>
      </div>


      <Table
        columns={columns}
        dataSource={nodes}
        size="middle"
        rowKey="key"
        pagination={{
          current: currentPage,
          pageSize: itemsPerPage,
          onChange: (page) => setCurrentPage(page),
        }}
        loading={{
          spinning: isScanning,
          tip: "Scanning...",
        }}
      />
      <div style={{ marginTop: "16px", display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: "14px" }}>
          <strong>Note:</strong>
          <br />
          1. To obtain your license key, copy the details from the table above and email them to
          <a href="mailto:support@pinakastra.cloud"> support@pinakastra.cloud</a> or contact us at
          <a href="tel:+919008488882"> +91 90084 88882</a>.
          <br />
          (OR)
          <br />
          2. If you have already purchased the license and completed the payment and you have the payment ID,
          visit <a href="https://pinakastra.com/generate-key" target="_blank" rel="noopener noreferrer">
            https://pinakastra.com/generate-key
          </a>, fill in the required details, and generate your activation key.
        </span>
      </div>
    </div>
  );
};

export default DataTable;
