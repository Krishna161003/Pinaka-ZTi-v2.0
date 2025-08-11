import React from 'react';
import { Progress, Spin, Row, Col } from 'antd';

const DeploymentProgressBar = ({ progress, filesProcessed, statusMessage }) => {
  return (
    <div>
      <Row>
        <Col span={24}>
          <Progress percent={progress} status="active" />
        </Col>
      </Row>
      <Row>
        <Col span={24}>
        </Col>
      </Row>
      <Row>
        <Col span={24}>
          <div>{statusMessage}</div>
        </Col>
      </Row>
      <Row>
        <Col span={24}>
          <div>{filesProcessed.length} / 9
             files processed</div>
        </Col>
      </Row>
    </div>
  );
};

export default DeploymentProgressBar;

