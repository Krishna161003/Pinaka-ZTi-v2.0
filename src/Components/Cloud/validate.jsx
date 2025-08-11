import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Tag, message, Empty } from 'antd';
import axios from 'axios';

const hostIP = window.location.hostname;

const ValidateTable = ({ nodes = [], onNext, results, setResults }) => {
    const [data, setData] = useState(results || []);
    const [infoModal, setInfoModal] = useState({ visible: false, details: '' });

    // Sync data with results or nodes
    useEffect(() => {
        if (results) setData(results);
        else setData(
            (nodes || []).map(node => ({
                ...node,
                key: node.ip,
                result: null,
                details: '',
                validating: false,
            }))
        );
    }, [results, nodes]);

    // Call backend validation API
    const handleValidate = async (ip) => {
        setData(prev => prev.map(row =>
            row.ip === ip ? { ...row, validating: true } : row
        ));

        try {
            const response = await axios.post(`https://${hostIP}:2020/validate`, {
                environment: 'production', // You might want to make this configurable
                mode: 'remote',
                host: ip
            });

            // Patch: unwrap array response from backend if needed
            let result = response.data;
            if (Array.isArray(result)) {
                result = result[0];
            }
            if (result.error) {
                throw new Error(result.error);
            }

            // Defensive: Ensure result.validation exists and is an object
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
                            validationData: result // Store full validation data
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

    const columns = [
        {
            title: 'IP Address',
            dataIndex: 'ip',
            key: 'ip',
        },
        {
            title: 'Validate',
            key: 'validate',
            render: (_, record) => (
                <Button
                    type="primary"
                    loading={record.validating}
                    onClick={() => handleValidate(record.ip)}
                    disabled={record.validating}
                    style={{ width: "95px" }}
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
                        // Show recommended vs actual in the popup
                        const recommended = {
                            cpu_cores: 48,
                            memory_gb: 128,
                            disks: 4,
                            network: 2
                        };
                        const actual = record.validationData || {};
                        const validation = (actual && typeof actual.validation === 'object') ? actual.validation : {};
                        const details = [
                            `CPU Cores: ${actual.cpu_cores ?? 'N/A'} (Recommended: ${recommended.cpu_cores}) (${validation.cpu === true ? '✓' : validation.cpu === false ? '✗' : '-'})`,
                            `Memory: ${actual.memory_gb ?? 'N/A'}GB (Recommended: ${recommended.memory_gb}GB) (${validation.memory === true ? '✓' : validation.memory === false ? '✗' : '-'})`,
                            `Disks: ${actual.data_disks ?? 'N/A'} (Recommended: ${recommended.disks}) (${validation.disks === true ? '✓' : validation.disks === false ? '✗' : '-'})`,
                            `Network Interfaces: ${actual.network_interfaces ?? 'N/A'} (Recommended: ${recommended.network}) (${validation.network === true ? '✓' : validation.network === false ? '✗' : '-'})`
                        ].join('\n');
                        setInfoModal({ visible: true, details });
                    }}
                    disabled={!record.result}
                    style={{ width: "95px" }}
                >
                    Info
                </Button>
            ),
        },
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 }}>
                <Button
                    size="middle"
                    style={{ width: "75px" }}
                    type="primary"
                    onClick={() => {
                        const anyValidated = data.some(row => row.result !== null);
                        if (!anyValidated) {
                            message.warning("Please validate at least one node before proceeding.");
                            return;
                        }
                        const passed = data.filter(row => row.result === "Pass");
                        if (passed.length === 0) {
                            message.error("All nodes failed validation. Please ensure at least one node passes before proceeding.");
                            return;
                        }
                        onNext && onNext(passed, data);
                    }}
                >
                    Next
                </Button>
            </div>
            <Table
                columns={columns}
                dataSource={data}
                rowKey="ip"
                pagination={false}
            />
            <Modal
                title="Validation Details"
                open={infoModal.visible}
                onCancel={() => setInfoModal({ visible: false, details: '' })}
                footer={null}
            >
                <div style={{ whiteSpace: 'pre-line' }}>{infoModal.details}</div>
            </Modal>
        </div>
    );
};

export default ValidateTable;
