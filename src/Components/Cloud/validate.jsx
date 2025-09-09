import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Tag, message, Empty, notification } from 'antd';
import axios from 'axios';

const hostIP = window.location.hostname;

const ValidateTable = ({ nodes = [], onNext, results, setResults, onRemoveNode, onUndoRemoveNode }) => {
    const [data, setData] = useState(results || []);
    const [infoModal, setInfoModal] = useState({ visible: false, details: '', record: null });

    // Sync data with results or nodes (robust merge to preserve statuses)
    useEffect(() => {
        setData(prev => {
            const nodeList = Array.isArray(nodes) ? nodes : [];
            const resList = Array.isArray(results) ? results : [];

            const prevMap = new Map(prev.map(r => [r.ip, r]));
            const resMap = new Map(resList.map(r => [r.ip, r]));

            const ipSet = new Set([
                ...nodeList.map(n => n.ip),
                ...resList.map(r => r.ip),
            ]);

            // If nothing to show yet, fall back to nodes initialization
            if (ipSet.size === 0) return prev;

            const merged = [];
            for (const ip of ipSet) {
                const baseNode = nodeList.find(n => n.ip === ip) || prevMap.get(ip) || resMap.get(ip) || { ip };
                const resRow = resMap.get(ip);
                const old = prevMap.get(ip);
                const resResult = (resRow && resRow.result !== undefined && resRow.result !== null) ? resRow.result : undefined;
                const resDetails = (resRow && resRow.details !== undefined && resRow.details !== null) ? resRow.details : undefined;
                const resValData = (resRow && resRow.validationData !== undefined && resRow.validationData !== null) ? resRow.validationData : undefined;
                merged.push({
                    ...baseNode,
                    key: ip,
                    // Prefer incoming results only when non-null; otherwise keep previous
                    result: (resResult !== undefined ? resResult : old?.result) ?? null,
                    details: (resDetails !== undefined ? resDetails : old?.details) ?? '',
                    validating: old?.validating ?? false,
                    validationData: (resValData !== undefined ? resValData : old?.validationData),
                });
            }
            return merged;
        });
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

    // Remove a node with confirmation and Undo support
    const handleRemove = (ip) => {
        Modal.confirm({
            title: `Remove ${ip}?`,
            content: 'This will remove the node from the list. You can undo within 5 seconds.',
            okText: 'Remove',
            okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
            cancelText: 'Cancel',
            cancelButtonProps: { size: 'small', style: { width: 90 } },
            onOk: () => {
                // Compute removed record/index synchronously to avoid relying on async state updates
                const prev = Array.isArray(data) ? data : [];
                const removedIndex = prev.findIndex(r => r.ip === ip);
                const removedRecord = removedIndex >= 0 ? prev[removedIndex] : null;
                const newData = prev.filter(row => row.ip !== ip);

                setData(newData);
                setResults && setResults(newData);
                
                // Inform parent to also remove from License Activation input lists
                try {
                    if (onRemoveNode) onRemoveNode(ip, removedRecord, removedIndex);
                } catch (_) {}

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

                            // Inform parent to restore in License Activation input lists
                            try {
                                if (onUndoRemoveNode) onUndoRemoveNode(ip, removedRecord, removedIndex);
                            } catch (_) {}
                        }}>
                            Undo
                        </Button>
                    ),
                });
            }
        });
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
            render: (result) => {
                const norm = typeof result === 'string' ? result.toLowerCase() : result;
                const isPass = result === 'Pass' || norm === 'pass' || norm === 'passed' || result === true;
                const isFail = result === 'Fail' || norm === 'fail' || norm === 'failed' || result === false;
                if (isPass) return <Tag color="green">Pass</Tag>;
                if (isFail) return <Tag color="red">Fail</Tag>;
                return <Tag>Pending</Tag>;
            }
        },
        {
            title: 'Info',
            key: 'info',
            render: (_, record) => (
                <Button
                    onClick={() => {
                        setInfoModal({ visible: true, details: '', record });
                    }}
                    disabled={!record.result && !record.validationData}
                    style={{ width: "95px" }}
                >
                    Info
                </Button>
            ),
        },
        {
            title: 'Remove',
            key: 'remove',
            render: (_, record) => (
                <Button
                    danger
                    onClick={() => handleRemove(record.ip)}
                    style={{ width: "95px" }}
                >
                    Remove
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
                        // Merge local data and incoming results by IP to avoid stale Pending
                        const map = new Map();
                        (Array.isArray(data) ? data : []).forEach(r => { if (r && r.ip) map.set(r.ip, r); });
                        (Array.isArray(results) ? results : []).forEach(r => { if (r && r.ip) map.set(r.ip, { ...map.get(r.ip), ...r }); });
                        const mergedRows = Array.from(map.values());
                        const normResult = (r) => {
                            const v = r?.result;
                            const s = typeof v === 'string' ? v.toLowerCase() : v;
                            if (v === 'Pass' || s === 'pass' || s === 'passed' || v === true) return 'Pass';
                            if (v === 'Fail' || s === 'fail' || s === 'failed' || v === false) return 'Fail';
                            return null;
                        };
                        const anyValidated = mergedRows.some(row => normResult(row) !== null);
                        if (!anyValidated) {
                            message.warning("Please validate at least one node before proceeding.");
                            return;
                        }
                        const passed = mergedRows.filter(row => normResult(row) === "Pass");
                        if (passed.length === 0) {
                            message.error("All nodes failed validation. Please ensure at least one node passes before proceeding.");
                            return;
                        }
                        onNext && onNext(passed, mergedRows);
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

export default ValidateTable;
