import React, { useState, useEffect } from 'react';
import { Divider, Table, Button, Modal, Tag, message, notification } from 'antd';
import axios from 'axios';

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null;
};
const hostIP = window.location.hostname;

const Validation = ({ nodes = [], onNext, next, results, setResults }) => {
  const cloudName = getCloudName();
  const [data, setData] = useState(results || []);
  const [infoModal, setInfoModal] = useState({ visible: false, details: '', record: null });
  const [removedIps, setRemovedIps] = useState([]);

  // Sync data with results or nodes (from Cloud validate.jsx)
  useEffect(() => {
    const removedSet = new Set(removedIps);
    if (results) {
      const filtered = (Array.isArray(results) ? results : []).filter(r => r && !removedSet.has(r.ip));
      setData(filtered);
    } else {
      const filteredNodes = (nodes || []).filter(n => n && !removedSet.has(n.ip));
      setData(
        filteredNodes.map(node => ({
          ...node,
          key: node.ip,
          result: null,
          details: '',
          validating: false,
        }))
      );
    }
  }, [results, nodes, removedIps]);

  // Validation handler (from Cloud validate.jsx)
  const handleValidate = async (ip) => {
    setData(prev => prev.map(row =>
      row.ip === ip ? { ...row, validating: true } : row
    ));

    try {
      const response = await axios.post(`https://${hostIP}:2020/validate`, {
        environment: 'production',
        mode: 'remote',
        host: ip
      });

      let result = response.data;
      if (Array.isArray(result)) {
        result = result[0];
      }
      if (result.error) {
        throw new Error(result.error);
      }

      const validation = (result && typeof result.validation === 'object') ? result.validation : {};
      const isPass = result.validation_result === 'passed';
      const details = [
        `CPU Cores: ${result.cpu_cores ?? 'N/A'} (${validation.cpu === true ? '✓' : validation.cpu === false ? '✗' : '-'})`,
        `Memory: ${result.memory_gb ?? 'N/A'}GB (${validation.memory === true ? '✓' : validation.memory === false ? '✗' : '-'})`,
        `Disks: ${result.data_disks ?? 'N/A'} (${validation.disks === true ? '✓' : validation.disks === false ? '✗' : '-'})`,
        `Network Interfaces: ${result.network_interfaces ?? 'N/A'} (${validation.network === true ? '✓' : validation.network === false ? '✗' : '-'})`
      ].join('\n');

      setData(prev => {
        const newData = prev.map(row =>
          row.ip === ip
            ? {
                ...row,
                result: isPass ? 'Pass' : 'Fail',
                details: details,
                validating: false,
                validationData: result
              }
            : row
        );
        setResults && setResults(newData);
        return newData;
      });

      message.success(`Validation for ${ip}: ${isPass ? 'Pass' : 'Fail'}`);
    } catch (error) {
      console.error('Validation error:', error);
      setData(prev => prev.map(row =>
        row.ip === ip 
          ? { 
              ...row, 
              result: 'Fail', 
              details: `Validation failed: ${error.message || 'Unknown error'}`,
              validating: false 
            } 
          : row
      ));
      message.error(`Validation failed for ${ip}: ${error.message || 'Unknown error'}`);
    }
  };

  // Remove a node from the table with confirm and Undo support
  const handleRemove = (ip) => {
    Modal.confirm({
      title: `Remove ${ip}?`,
      content: 'This will remove the node from the list. You can undo within 5 seconds.',
      okText: 'Remove',
      okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
      cancelText: 'Cancel',
      cancelButtonProps: { size: 'small', style: { width: 90 } },
      onOk: () => {
        // Compute removed record/index synchronously from current state
        const prev = Array.isArray(data) ? data : [];
        const removedIndex = prev.findIndex(r => r.ip === ip);
        const removedRecord = removedIndex >= 0 ? prev[removedIndex] : null;
        const newData = prev.filter(row => row.ip !== ip);
        setData(newData);
        setResults && setResults(newData);
        setRemovedIps(list => (list.includes(ip) ? list : [...list, ip]));
        const key = `remove-${ip}`;
        notification.open({
          key,
          message: `Removed ${ip}`,
          description: 'The node was removed.',
          duration: 5,
          btn: (
            <Button type="link" onClick={() => {
              notification.destroy(key);
              if (removedRecord && removedIndex > -1) {
                setData(cur => {
                  const arr = [...cur];
                  const idx = Math.min(Math.max(removedIndex, 0), arr.length);
                  arr.splice(idx, 0, removedRecord);
                  setResults && setResults(arr);
                  return arr;
                });
              }
              setRemovedIps(list => list.filter(x => x !== ip));
            }}>
              Undo
            </Button>
          ),
        });
      }
    });
  };

  const columns = [
    { title: 'IP Address', dataIndex: 'ip', key: 'ip' },
    {
      title: 'Validate',
      key: 'validate',
      render: (_, record) => (
        <Button
          type="primary"
          loading={record.validating}
          onClick={() => handleValidate(record.ip)}
          disabled={record.validating}
          style={{ width: '95px' }}
        >
          Validate
        </Button>
      ),
    },
    {
      title: 'Result',
      dataIndex: 'result',
      key: 'result',
      render: (result) =>
        result === 'Pass' ? <Tag color="green">Pass</Tag> :
        result === 'Fail' ? <Tag color="red">Fail</Tag> : <Tag>Pending</Tag>
    },
    {
      title: 'Info',
      key: 'info',
      render: (_, record) => (
        <Button
          onClick={() => {
            setInfoModal({ visible: true, details: '', record });
          }}
          disabled={!record.result}
          style={{ width: '95px' }}
        >
          Info
        </Button>
      ),
    },
    {
      title: 'Remove',
      key: 'remove',
      render: (_, record) => (
        <Button danger onClick={() => handleRemove(record.ip)} style={{ width: '95px' }}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ marginBottom: '-16px', marginTop: '3px' }}>
          Cloud Name: <span style={{ color: '#1890ff' }}>{cloudName}</span>
        </h4>
        <Button
          size="middle"
          style={{ width: '75px' }}
          type="primary"
          onClick={() => {
            const anyValidated = data.some(row => row.result !== null);
            if (!anyValidated) {
              message.warning('Please validate at least one node before proceeding.');
              return;
            }
            const passed = data.filter(row => row.result === 'Pass');
            if (passed.length === 0) {
              message.error('All nodes failed validation. Please ensure at least one node passes before proceeding.');
              return;
            }
            if (onNext) onNext(passed, data);
            else if (next) next(passed, data);
          }}
        >
          Next
        </Button>
      </div>

      <Divider />

      <Table
        columns={columns}
        dataSource={data}
        rowKey="ip"
        pagination={false}
      />
      <Modal
        title="Validation Details"
        open={infoModal.visible}
        onCancel={() => setInfoModal({ visible: false, details: '', record: null })}
        footer={null}
        width={600}
      >
        {infoModal.record && (() => {
          const recommended = { cpu_cores: 48, memory_gb: 128, disks: 4, network: 2 };
          const actual = infoModal.record.validationData || {};
          const validation = (actual && typeof actual.validation === 'object') ? actual.validation : {};
          
          const tableData = [
            {
              key: 'cpu',
              component: 'CPU Cores',
              actual: actual.cpu_cores ?? 'N/A',
              recommended: recommended.cpu_cores,
              status: validation.cpu === true ? '✓ Pass' : validation.cpu === false ? '✗ Fail' : '-'
            },
            {
              key: 'memory',
              component: 'Memory',
              actual: actual.memory_gb ? `${actual.memory_gb}GB` : 'N/A',
              recommended: `${recommended.memory_gb}GB`,
              status: validation.memory === true ? '✓ Pass' : validation.memory === false ? '✗ Fail' : '-'
            },
            {
              key: 'disks',
              component: 'Disks',
              actual: actual.data_disks ?? 'N/A',
              recommended: recommended.disks,
              status: validation.disks === true ? '✓ Pass' : validation.disks === false ? '✗ Fail' : '-'
            },
            {
              key: 'network',
              component: 'Network Interfaces',
              actual: actual.network_interfaces ?? 'N/A',
              recommended: recommended.network,
              status: validation.network === true ? '✓ Pass' : validation.network === false ? '✗ Fail' : '-'
            }
          ];
          
          const columns = [
            {
              title: 'Component',
              dataIndex: 'component',
              key: 'component',
              width: 150
            },
            {
              title: 'Actual',
              dataIndex: 'actual',
              key: 'actual',
              align: 'center',
              width: 100
            },
            {
              title: 'Recommended',
              dataIndex: 'recommended',
              key: 'recommended',
              align: 'center',
              width: 120
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              align: 'center',
              width: 100,
              render: (status) => (
                <span style={{
                  color: status.includes('✓') ? '#52c41a' : status.includes('✗') ? '#ff4d4f' : '#666',
                  fontWeight: status !== '-' ? 'bold' : 'normal'
                }}>
                  {status}
                </span>
              )
            }
          ];
          
          return (
            <Table
              dataSource={tableData}
              columns={columns}
              pagination={false}
              size="small"
              bordered
            />
          );
        })()}
      </Modal>
    </div>
  );
};

export default Validation;
