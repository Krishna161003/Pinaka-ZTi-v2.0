import React from "react";
import Layout1 from "./layout";
import { theme, Layout, Col, Row, Tooltip } from "antd";
import { useNavigate } from "react-router-dom";
import addnode from "../Images/database_666401.png";
import node from "../Images/database_666406.png";

const style = {
  background: '#fff',
  padding: '36px 20px',
  marginTop: '19px',
  marginRight: '25px',
  // borderRadius: '10px',
  cursor: 'pointer',
  boxShadow: '10px',
};

const { Content } = Layout;

export default function Zti({ children }) {
  const navigate = useNavigate();
  const [hostExists, setHostExists] = React.useState(false);

  // Check if Host entry exists to enable/disable Add Node card
  React.useEffect(() => {
    const hostIP = window.location.hostname;
    try {
      const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
      const userId = loginDetails?.data?.id;
      if (!userId) {
        setHostExists(false);
        return;
      }
      fetch(`https://${hostIP}:5000/api/host-exists?userId=${encodeURIComponent(userId)}`)
        .then(res => res.json())
        .then(data => {
          setHostExists(!!data.exists);
        })
        .catch(() => setHostExists(false));
    } catch (_) {
      setHostExists(false);
    }
  }, []);


  const handleRedirect = () => {
    const lastServerVirtualizationPath = sessionStorage.getItem("lastServerVirtualizationPath") || "/servervirtualization";
    navigate(lastServerVirtualizationPath);
  };

  // For Cloud
  const handleRedirectAddNode = () => {
    const lastCloudPath = sessionStorage.getItem("lastCloudPath") || "/addnode";
    navigate(lastCloudPath);
  };


  const handleRedirectRemoveNode = () => {
    const lastEdgeCloudPath = sessionStorage.getItem("lastEdgeCloudPath") || "/edgecloud";
    navigate(lastEdgeCloudPath);
  };
  const handleDistributedStorage = () => {
    const lastDistributedStoragePath = sessionStorage.getItem("lastDistributedStoragePath") || "/distributedstorage";
    navigate(lastDistributedStoragePath);
  };


  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  return (
    <Layout1>
      <Row
        gutter={16} // Added gutter for spacing
        justify="space-between" // Ensures equal spacing between the columns
        style={{ marginLeft: "20px" }} // Added marginLeft to shift everything a bit to the right
      >
        <Col
          className="gutter-row"
          span={7} // Each column takes up 7 spans
          onClick={handleRedirect}
          style={style}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={node} alt="server" style={{ width: "60px", height: "60px", marginLeft: "30px", userSelect: "none" }}></img>
            <span
              style={{
                fontSize: "18px",
                fontWeight: "500",
                marginLeft: "30px",
                userSelect: "none",
              }}
            >
              Server Virtualization
            </span>
          </div>
        </Col>

        <Col
          className="gutter-row"
          span={7} // Each column takes up 7 spans
          onClick={hostExists ? handleRedirectAddNode : undefined}
          style={{
            ...style,
            cursor: hostExists ? 'pointer' : 'not-allowed',
            opacity: hostExists ? 1 : 0.6,
          }}
        >
          <Tooltip title="Flight Deck Not deployed" placement="top" open={hostExists ? false : undefined} disabled={hostExists}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <img src={addnode} alt="cloud--v1" style={{ width: "60px", height: "60px", marginLeft: "30px", userSelect: "none" }}></img>
              <span
                style={{
                  fontSize: "18px",
                  fontWeight: "500",
                  marginLeft: "30px",
                  userSelect: "none"
                }}
              >
                Add Node
              </span>
            </div>
          </Tooltip>
        </Col>

        <Col
          className="gutter-row"
          span={7} // Each column takes up 7 spans
          onClick={handleRedirectRemoveNode}
          style={style}
        >
          <div style={{ display: "flex", alignItems: "center" }}>

            <img src="data:image/png;base64,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" alt="cloud-development--v3"

              style={{ width: "60px", height: "60px", marginLeft: "30px", userSelect: "none" }}></img>
            <span
              style={{
                fontSize: "18px",
                fontWeight: "500",
                marginLeft: "30px",
                userSelect: "none"
              }}
            >
              Edge Cloud
            </span>
          </div>
        </Col>



        {/* <Col
          className="gutter-row"
          span={5} // Each column takes up 7 spans
          onClick={handleDistributedStorage}
          style={style}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFZklEQVR4nO1bWYgcZRD+4xFEk4Cg4o0aj7gPgu7u/P9MNqwIXqCo6BoRwYvsiyS421Wz69NoEBPRBw/wQVEjigE1moDBB4UEjSIEIqgviokSkhDjydpVPVHZlur+Z8+ZnZ7p7tmZsT9o2On+j6rq+r86ZlapDBnaFkND/ok55DUG6FmN9IVG+kkDeQbJNUgHDPJ7Bmmk91H3HNVVKPknaOD7RGGD7Ne7NNA/BvjdAngrVadDj3kXGeC9UwoCfW+AS9rxru0H9+zeYf/kwZK/TBfLV5oi36+R3w8MEBrC08hjSvlLVCciVyRjgI+GytMBDXRnFGVyRTpfA709wyPe6in5SxMRqgDeSo38kQGiKO6YyAW8rYD+8kZlzRXproqcGmhLbE8YLPknBS7YKsXt2xMOaFZmA7xaI7H1opFYBsg53nWBUEg/DDw2caZKCQb5eWuAL+WMx11PO3yPNYC7eowvbHqhHDCEb4VfVKmSHh03SH8XsHxFYusCf2BJ9LUYi9AW6wHDKiUY5Jfs23o9yXX7R8uXG6RJOQ4D43+e3tQiGnmfCFcAzicpXG/JP1UDjxuk7ypnvx+pTyUMDfRJ6MHeA00RoA6zrslmGHlhXqGDs4mPj6URu4UE7R4vNzxZS6Jh43FSAuXRe6iStAjhGaRnbNjbqVKARAS7/t7GJzt8t528Iwlh8ujeopH+taHuCcnzxTXt51dVCsg53sVNv0SDtNFOfjKuIL2jE2cY4F9DQpVUNUQe6fZE4nUN9I3yBXb9gw1PNsjbrcBrk2N6/nDuWZc0No3zL3WDdmhDxQMajgQGaL9MzjnlnjiC5Nb7KyQhEfeX0KRaBCmfZxFtcPxoqxn3Lq07ebDkL7MxtCzRIImsTCN9HGedhvcteg9q5HekSNJIe6bJl9ywyKpXlWHg/l/FFcQAP2fJtKgWEXLUDNKbFW/QRe/6moM1uOvswDfibiz1enCUgG5TbQAhdXssjoin1ytOMPaGwDsDYzruzapduk2WH7RDG6qOMUi7Qrd1b4q7n+T4wVqO97BqE+SRh2z+sbvqgErMNiN0XtzNwpw/3YqyUeSdv86yHPfbvIcFpHNrPmwCBt1rLAkejRtRksJgyT/FlsrH5z3MF90bbbjYldSGGvhrS4SPqDaA5DbWAPtrN0GQX0hqQ+PQrXbNPzSWL1OLDI30+HTfcA4k9KXRBJG+fSUtlSJFLRL6xr1LNNBE4JHIa1rbBKmEH+DfDfC9cZqfMbpEtglDW1vWBJlVFwBvm87P+RvJEPOj7tVSMaoUIIYXItZIT4dfqYX9gapJkK40QaqRQ2LwlwR9AKAfW9lut299UpqkVzn+aQs3QZC3q5Qh7W8DdIcGfiXwBORfUvqewTPA30oeIp4QMU+mjarDMUOX6A0dA7xDJkmqqDoc0shpuKVnwu/c/fxoeZXqcDTc1C2gvzypJkg7YGZEk+hTd0IBOG9D0z7VJZCGTpDwFMlEGEzDNdPDDsVUVgvuuvqDQcJE4AGO6hI0VNdooN1hxebdoLoEDVW2Gvnn1mdmrblEt7oGMJImtoGw6Vw0GcEAHAxWXYbIepnMAJx5gMmOAM87K/KDw7CZwEc08GEDtDmxHyF2AgcYoM2VUDIdKmlTXME00OcG6LM07y2kl4o6UAMfFsWlWJJLfs8j92ZtPDfsVBEkyn5J30vcALn1/orAAMiHpp4j7aligE+7xgAGadPUEQA+FvwN9JSKicBwcwyV9L2F9FJRB/aU/KViBOsJh0T5/xUJdjoyA2DmAX4kz9aS5AjBjfGA6hIE/3AVEvhU1KoJY9m+G69IUatnBtt3jeIdGLUyZMiQIYNqIf4DTUlVDVrtZMoAAAAASUVORK5CYII=" alt="cloud-storage" style={{ width: "60px", height: "60px", marginLeft: "30px", userSelect: "none" }}></img>
            <span
              style={{
                fontSize: "18px",
                fontWeight: "500",
                marginLeft: "30px",
                userSelect: "none"
              }}
            >
              Distributed Storage
            </span>
          </div>
        </Col> */}
      </Row>
      <Content style={{ margin: "16px 16px" }}>
        <div
          style={{
            padding: 30,
            minHeight: "auto",
            width: "99.5%",
            marginLeft: "4px",
            background: colorBgContainer,
            // borderRadius: borderRadiusLG,
          }}
        >
          {children}
        </div>
      </Content>
    </Layout1>
  );
}
