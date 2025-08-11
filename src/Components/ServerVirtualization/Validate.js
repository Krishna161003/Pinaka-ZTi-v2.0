import React, { useState } from "react";
import { Divider, Button, Spin, notification } from "antd";
import { HomeOutlined, CloudOutlined } from "@ant-design/icons";
import axios from "axios";

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null;
};
const hostIP = window.location.hostname;


const Validation = ({ nodes, onIbnUpdate, next, onValidationResult }) => {
  const cloudName = getCloudName();
  const [api, contextHolder] = notification.useNotification();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleValidation = async (environment) => {
    try {
      setLoading(true);
      setError(null);
      setResults(null);

      const response = await axios.post(`https://${hostIP}:2020/validate`, {
        environment,
        mode: "local",
      });
      const data = response.data?.[0];
      setResults(data);
      // Notify parent of validation result
      if (onValidationResult) {
        if (
          typeof data.validation_result === "string" &&
          data.validation_result.trim().toLowerCase() === "passed"
        ) {
          onValidationResult("passed");
        } else {
          onValidationResult("failed");
        }
      }
    } catch (err) {
      const errorMessage = "Validation failed. Please try again.";
      setError(errorMessage);
      console.error(err);

      // Show error using Ant Design Notification
      api.error({
        message: "Validation Error",
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const renderResult = () => {
    if (!results && !error) {
      return <p style={{ color: "#555" }}>Please run a validation to see results.</p>;
    }
    if (error) {
      return <p style={{ color: "red" }}>{error}</p>;
    }
    if (results) {
      return (
        <div style={{ fontSize: "13px" }}>
          <p>CPU Cores: {results.cpu_cores}</p>
          <p>Memory: {results.memory_gb}GB</p>
          <p>Data Disks: {results.data_disks}</p>
          <p>Network Interfaces: {results.network_interfaces}</p>
          <p>Validation Result: {results.validation_result}</p>
          <div style={{ marginTop: "8px" }}>
            <strong>Details:</strong>
            <ul style={{ listStyle: "none", paddingLeft: 0 }}>
              <li>CPU: {results.validation.cpu ? "✅ Pass" : "❌ Fail"}</li>
              <li>Disks: {results.validation.disks ? "✅ Pass" : "❌ Fail"}</li>
              <li>Memory: {results.validation.memory ? "✅ Pass" : "❌ Fail"}</li>
              <li>Network: {results.validation.network ? "✅ Pass" : "❌ Fail"}</li>
            </ul>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ padding: "20px" }}>
      {contextHolder}
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        {/* <Breadcrumb style={{ margin: 0 }}>
          <Breadcrumb.Item>
            <HomeOutlined />
          </Breadcrumb.Item>
          <Breadcrumb.Item>Deployment Options</Breadcrumb.Item>
          <Breadcrumb.Item>Server Validation</Breadcrumb.Item>
        </Breadcrumb> */}
        <h4 style={{marginBottom: "-16px", marginTop: "-17px"}}>
          Cloud Name: <span style={{ color: "blue" }}>{cloudName}</span>
        </h4>
        <Button
          type="primary"
          style={{ width: 70, minWidth: 80, height: 36, marginLeft: 8, verticalAlign: 'middle' }}
          disabled={!(
            results &&
            typeof results.validation_result === "string" &&
            results.validation_result.trim().toLowerCase() === "passed"
          )}
          onClick={next}
        >
          Next
        </Button>
      </div>

      <Divider/>

      <div style={{ display: "flex", flex: "1", gap: "30px", padding: "20px" }}>
        {/* Button Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "60px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h5>Validation for development environment:</h5>
            <Button
              type="primary"
              size="large"
              style={{ width: "120px", height: "35px" }}
              onClick={() => handleValidation("development")}
            >
              Validate
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h5>
              Validation for production <br /> environment:
            </h5>
            <Button
              type="primary"
              size="large"
              style={{ width: "120px", height: "35px" }}
              onClick={() => handleValidation("production")}
            >
              Validate
            </Button>
          </div>
        </div>

        {/* Image, Line, and Result Box */}
        <div style={{ display: "flex", alignItems: "center", flex: 1, gap: "20px" }}>
          {/* Image + Loading Spinner */}
          <div style={{ position: "relative" }}>
            {loading && (
              <div
                style={{
                  position: "absolute",
                  top: "60%",
                  left: "60%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 1,
                }}
              >
                <Spin style={{ marginLeft: "25px" }} ></Spin>
                <p>Validating...</p>
              </div>
            )}
            <img
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAACnElEQVR4nO1azWoUQRBuMIgeNGaz3V4igj8IvoBexKfYY6JvIIJTteBhbm68iw8RFm8q6EVZfYcknjYkgkpAk4u3T2rsLKuuYWa2ZzM9Wx/UpZfurqqvf+arXmMUCoVCocgNR7htCW8d4dAxUAsjHFrGm4td3DJVop3grmX8PPGA/2PiWzvBnWqi7+CUI2z5jD9bfIALpiYQXxzjufdtS3wNPollrI0mSLFg6oYUC46x7VfCWnj22Q+eYFWaHOPjDPf4hyNXJs7rfx+RxNgOugrsOPt+YJl0hvt7MErA5HkH1a2CTsb+5jj7dYYl3PNkfQqyVW3oAavGOGFTr4JOXOwHJ83Gxn7QVdCJk/1g5NkEq5VcKbPChKu7EBzhvV9C902kEN89ie8Kd3aMA+m8xFg0kUJ89wk4KNzZ1UDchDRNQFG4spmrGaZeASZyNDYBN1OcdoynjvDZMfYcYV3aKk+AEzk6Jk+raMvlH2HdX9NfxLy/vbxxTJMA/N0esu3YOsOfdYE9CXw5wTkxS/gqbfEngI6tMwwmJaCV4nyWAMJu9QmgzMFBlW05/euNtsBv9sXfJ3njaMoh2PMH4K4EH/YQJPyQji3CiokUS49xySfge+HOjtD3nV/JQCbG4Amv/eG5UXgA28U1y/h20t/w01oWQxdXCiegneB6UxJgH+Fq+S1AeBnjOSA+y/YtvQXc3B+CHMU1qFrAqhaAaoGWagGoFnCqBf6FagFSLQDVAqxaAKoFuExBhFULIJJ3gaHYvL4LDC+nOCNmCTvz+C4wlOBXHuJsloC5fBcg7Hj2xV99FzA5icz9F5lWhPXAIFrAEl406F2gX3iA5QQ3LGO/AWXxfSnxly8tEzaOKsRRmfhM6JcOXqFQKBSm+fgF8tw4l4opeaIAAAAASUVORK5CYII="
              alt="server"
              style={{
                width: "200px",
                height: "220px",
                userSelect: "none",
                justifyItems: "center",
                marginLeft: "13%",
                opacity: loading ? 0.3 : 1,
              }}
            />
          </div>

          {/* Line with arrow */}
          <div
            style={{
              position: "relative",
              display: "flex",
              flex: 1,
              height: "4px",
              backgroundColor: "#000000",
              alignItems: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-50%) translateX(100%)",
                width: 0,
                height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderLeft: "8px solid #000000",
              }}
            />
          </div>

          {/* Result Box */}
          <div
            style={{
              backgroundColor: "#fafafa",
              border: "1px solid #ccc",
              borderRadius: "8px",
              padding: "16px",
              width: "260px",
              height: "220px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
              overflowY: "auto",
            }}
          >
            <h4
              style={{
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              Validation Result:
              {results && (
                results.validation_result === "failed" ? (
                  <span style={{ fontSize: "1.2em", color: "red" }}>❌</span>
                ) : (
                  <span style={{ fontSize: "1.2em", color: "green" }}>✅</span>
                )
              )}
            </h4>
            {renderResult()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Validation;
