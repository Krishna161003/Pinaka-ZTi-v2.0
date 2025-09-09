import React, { useState, useEffect, useRef } from 'react';
import { Table, Button, Input, Tag, message, Modal, notification, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import axios from 'axios';
import * as XLSX from 'xlsx';

const LicenseActivation = ({ nodes = [], results, setResults, onNext, onRemoveNode, onUndoRemoveNode }) => {
    const [data, setData] = useState(results || []);
    const fileInputRef = useRef(null);
    const [removedIps, setRemovedIps] = useState([]);

    useEffect(() => {
        // Robust merge: combine nodes + results + previous local state, keyed by IP.
        setData(prev => {
            const nodeList = Array.isArray(nodes) ? nodes : [];
            const resList = Array.isArray(results) ? results : [];

            const prevMap = new Map(prev.map(r => [r.ip, r]));
            const resMap = new Map(resList.map(r => [r.ip, r]));
            const ipSet = new Set([
                ...nodeList.map(n => n.ip),
                ...resList.map(r => r.ip),
            ]);

            if (ipSet.size === 0) return prev;

            const removedSet = new Set(removedIps);
            const merged = [];
            for (const ip of ipSet) {
                if (removedSet.has(ip)) continue; // honor local removals
                const baseNode = nodeList.find(n => n.ip === ip) || prevMap.get(ip) || resMap.get(ip) || { ip };
                const rRow = resMap.get(ip);
                const old = prevMap.get(ip);
                const rResult = (rRow && rRow.result !== undefined && rRow.result !== null) ? rRow.result : undefined;
                const rDetails = (rRow && rRow.details !== undefined && rRow.details !== null) ? rRow.details : undefined;
                const rLicense = (rRow && rRow.license !== undefined && rRow.license !== null) ? rRow.license : undefined;
                const rChecking = (rRow && rRow.checking !== undefined && rRow.checking !== null) ? rRow.checking : undefined;
                merged.push({
                    ...baseNode,
                    key: ip,
                    license: (rLicense !== undefined ? rLicense : old?.license) ?? '',
                    result: (rResult !== undefined ? rResult : old?.result) ?? null,
                    details: (rDetails !== undefined ? rDetails : old?.details) ?? null,
                    checking: (rChecking !== undefined ? rChecking : old?.checking) ?? false,
                });
            }
            return merged;
        });
    }, [results, nodes, removedIps]);

    const handleLicenseChange = (ip, value) => {
        setData(prev => prev.map(row =>
            row.ip === ip ? { ...row, license: value } : row
        ));
    };

    // Call backend to validate license
    const handleCheck = async (ip) => {
        const row = data.find(r => r.ip === ip);
        if (!row || !row.license) return;

        setData(prev => prev.map(row =>
            row.ip === ip ? { ...row, checking: true } : row
        ));

        try {
            const response = await axios.post(`https://${ip}:2020/decrypt-code`, {
                encrypted_code: row.license
            });

            const result = response.data;

            if (result.success) {
                setData(prev => {
                    const newData = prev.map(row =>
                        row.ip === ip
                            ? {
                                ...row,
                                result: 'Success',
                                details: {
                                    type: result.key_type || 'N/A',
                                    period: (String(row.license || '').trim().toLowerCase() === 'perpetual')
                                        ? null
                                        : (result.license_period ? `${result.license_period}` : 'N/A'),
                                    mac_address: result.mac_address,
                                    socket_count: result.socket_count,
                                    licenseCode: row.license || '-' // Store the license code
                                },
                                checking: false,
                            }
                            : row
                    );
                    setResults && setResults(newData);
                    return newData;
                });
                message.success(`License validated successfully for ${ip}`);
            } else {
                throw new Error(result.message || 'License validation failed');
            }
        } catch (error) {
            console.error('License validation error:', error);
            setData(prev => prev.map(row =>
                row.ip === ip
                    ? {
                        ...row,
                        result: 'Failed',
                        details: { type: 'N/A', period: 'N/A' },
                        checking: false,
                    }
                    : row
            ));
            message.error(`License validation failed for ${ip}: ${error.response?.data?.message || error.message}`);
        }
    };

    // Handle bulk upload of licenses from Excel file
    const handleBulkUpload = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                // Validate file structure
                if (jsonData.length < 2) {
                    message.error('Invalid file format. File must contain headers and at least one data row.');
                    return false;
                }

                // Check headers (first row)
                const headers = jsonData[0].map(header => header.toString().trim().toLowerCase());
                const ipIndex = headers.indexOf('ip address');
                const licenseIndex = headers.indexOf('license');

                if (ipIndex === -1 || licenseIndex === -1) {
                    message.error('Invalid file format. File must contain "IP Address" and "License" columns.');
                    return false;
                }

                // Process data rows
                const licenseMap = new Map();
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row.length > Math.max(ipIndex, licenseIndex)) {
                        const ip = row[ipIndex]?.toString().trim();
                        const license = row[licenseIndex]?.toString().trim();
                        
                        if (ip && license) {
                            licenseMap.set(ip, license);
                        }
                    }
                }

                // Update data with licenses
                setData(prev => prev.map(row => {
                    if (licenseMap.has(row.ip)) {
                        return { ...row, license: licenseMap.get(row.ip) };
                    }
                    return row;
                }));

                message.success(`Successfully imported licenses for ${licenseMap.size} nodes.`);
            } catch (error) {
                console.error('Bulk upload error:', error);
                message.error('Failed to process the Excel file. Please check the file format.');
            }
        };
        reader.readAsArrayBuffer(file);
        return false; // Prevent default upload behavior
    };

    // Remove node with confirmation and session cleanup + Undo
    const handleRemove = (ip) => {
        Modal.confirm({
            title: `Remove ${ip}?`,
            content: 'This will remove the node and its license details from this step. You can undo within 5 seconds.',
            okText: 'Remove',
            okButtonProps: { danger: true, size: 'small', style: { width: 90 } },
            cancelText: 'Cancel',
            cancelButtonProps: { size: 'small', style: { width: 90 } },
            onOk: () => {
                // Snapshot session-related entries before UI/state changes
                const snapshot = {
                    activationResultsIndex: -1,
                    activationResultsEntry: null,
                    licenseNodesIndex: -1,
                    licenseNodesEntry: null,
                };

                // Clean Cloud session arrays
                try {
                    const arrRaw = sessionStorage.getItem('cloud_licenseActivationResults');
                    const arr = arrRaw ? JSON.parse(arrRaw) : null;
                    if (Array.isArray(arr)) {
                        const idx = arr.findIndex(e => e && e.ip === ip);
                        if (idx > -1) {
                            snapshot.activationResultsIndex = idx;
                            snapshot.activationResultsEntry = arr[idx];
                            const next = arr.filter(e => e && e.ip !== ip);
                            sessionStorage.setItem('cloud_licenseActivationResults', JSON.stringify(next));
                        }
                    }
                } catch (_) {}
                try {
                    const nodesRaw = sessionStorage.getItem('cloud_licenseNodes');
                    const nodes = nodesRaw ? JSON.parse(nodesRaw) : null;
                    if (Array.isArray(nodes)) {
                        const idx = nodes.findIndex(e => e && e.ip === ip);
                        if (idx > -1) {
                            snapshot.licenseNodesIndex = idx;
                            snapshot.licenseNodesEntry = nodes[idx];
                            const next = nodes.filter(e => e && e.ip !== ip);
                            sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(next));
                        }
                    }
                } catch (_) {}

                // Compute removed row synchronously from current state to avoid relying on async setState
                const prev = Array.isArray(data) ? data : [];
                const removedIndex = prev.findIndex(r => r.ip === ip);
                const removedRecord = removedIndex >= 0 ? prev[removedIndex] : null;
                const newData = prev.filter(row => row.ip !== ip);
                setData(newData);
                setResults && setResults(newData);
                // Track locally removed IPs so merge doesn’t resurrect it from props
                setRemovedIps(list => (list.includes(ip) ? list : [...list, ip]));
                
                // Inform parent to also remove from Validation input lists
                try {
                    if (onRemoveNode) onRemoveNode(ip, removedRecord, removedIndex);
                } catch (_) {}

                const key = `cloud-remove-${ip}`;
                notification.open({
                    key,
                    message: `Removed ${ip}`,
                    description: 'The node and its license info were removed.',
                    duration: 5,
                    btn: (
                        <Button type="link" onClick={() => {
                            notification.destroy(key);
                            // Restore session entries
                            try {
                                if (snapshot.activationResultsEntry && snapshot.activationResultsIndex > -1) {
                                    const arrRaw = sessionStorage.getItem('cloud_licenseActivationResults');
                                    const arr = arrRaw ? JSON.parse(arrRaw) : [];
                                    const idx = Math.min(Math.max(snapshot.activationResultsIndex, 0), arr.length);
                                    arr.splice(idx, 0, snapshot.activationResultsEntry);
                                    sessionStorage.setItem('cloud_licenseActivationResults', JSON.stringify(arr));
                                }
                            } catch (_) {}
                            try {
                                if (snapshot.licenseNodesEntry && snapshot.licenseNodesIndex > -1) {
                                    const nodesRaw = sessionStorage.getItem('cloud_licenseNodes');
                                    const nodes = nodesRaw ? JSON.parse(nodesRaw) : [];
                                    const idx = Math.min(Math.max(snapshot.licenseNodesIndex, 0), nodes.length);
                                    nodes.splice(idx, 0, snapshot.licenseNodesEntry);
                                    sessionStorage.setItem('cloud_licenseNodes', JSON.stringify(nodes));
                                }
                            } catch (_) {}
                            // Restore UI row
                            if (removedRecord && removedIndex > -1) {
                                setData(cur => {
                                    const arr = [...cur];
                                    const idx = Math.min(Math.max(removedIndex, 0), arr.length);
                                    arr.splice(idx, 0, removedRecord);
                                    setResults && setResults(arr);
                                    return arr;
                                });
                            }
                            // Allow re-removal
                            setRemovedIps(list => list.filter(x => x !== ip));

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
            title: 'License',
            key: 'license',
            render: (_, record) => (
                <span style={{ display: 'flex', gap: 8 }}>
                    <Input
                        value={record.license}
                        onChange={e => handleLicenseChange(record.ip, e.target.value)}
                        placeholder="Enter license key"
                        style={{ width: 150 }}
                        maxLength={12}
                        disabled={record.checking}
                    />
                    <Button
                        type="primary"
                        loading={record.checking}
                        onClick={() => handleCheck(record.ip)}
                        disabled={!record.license || record.checking}
                        style={{ width: 70 }}
                    >
                        Check
                    </Button>
                </span>
            ),
        },
        {
            title: 'Result',
            dataIndex: 'result',
            key: 'result',
            render: (result) => {
                const norm = typeof result === 'string' ? result.toLowerCase() : result;
                const isSuccess = result === 'Success' || norm === 'success' || norm === 'pass' || norm === 'passed' || result === true;
                const isFail = result === 'Failed' || norm === 'failed' || norm === 'fail' || result === false;
                if (isSuccess) return <Tag color="green">Success</Tag>;
                if (isFail) return <Tag color="red">Failed</Tag>;
                return <Tag>Pending</Tag>;
            }
        },
        {
            title: 'Details',
            key: 'details',
            render: (_, record) => (
                <div>
                    <div>Type: <b>{record.details?.type || '-'}</b></div>
                    <div>Period (Days): <b>{record.details?.period || '-'}</b></div>                    {record.details?.mac_address && (
                        <div>MAC: <b>{record.details.mac_address}</b></div>
                    )}
                    {record.details?.socket_count && (
                        <div>Sockets: <b>{record.details.socket_count}</b></div>
                    )}
                </div>
            ),
        },
        {
            title: 'Remove',
            key: 'remove',
            render: (_, record) => (
                <Button danger onClick={() => handleRemove(record.ip)} style={{ width: 90 }}>
                    Remove
                </Button>
            ),
        },
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Upload
                    accept=".xlsx,.xls"
                    beforeUpload={handleBulkUpload}
                    showUploadList={false}
                >
                    <Button style={{ width: "120px" }} icon={<UploadOutlined />}>Bulk Upload</Button>
                </Upload>
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
                            if (v === 'Success' || s === 'success' || s === 'pass' || s === 'passed' || v === true) return 'Success';
                            if (v === 'Failed' || s === 'failed' || s === 'fail' || v === false) return 'Failed';
                            return null;
                        };
                        const anyValidated = mergedRows.some(row => normResult(row) !== null);
                        if (!anyValidated) {
                            message.warning('Please validate at least one license before proceeding.');
                            return;
                        }
                        const successfulNodes = mergedRows.filter(row => normResult(row) === 'Success');
                        if (successfulNodes.length === 0) {
                            message.error('All licenses failed validation. Ensure at least one license validates before proceeding.');
                            return;
                        }
                        if (typeof onNext === 'function') onNext(successfulNodes);
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
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: "14px" }}>
                    <strong>Note:</strong>
                    <br />
                    1. To obtain your license key, Access the page https://nodeip:1010 and copy the details from the table in the page and email them to
                    <a href="mailto:support@pinakastra.cloud"> support@pinakastra.cloud</a> or contact us at
                    <a href="tel:+919008488882"> +91 90084 88882</a>.
                    <br />
                    (OR)
                    <br />
                    2. If you have already purchased the license and completed the payment and you have the payment ID,
                    visit <a href="https://pinakastra.com/generate-key" target="_blank" rel="noopener noreferrer">
                        https://pinakastra.com/generate-key
                    </a>, fill in the required details, and generate your activation key.
                    <br />
                    <br />
                    <strong>Bulk Upload Instructions:</strong>
                    <br />
                    Create an Excel file with two columns: "IP Address" and "License".
                    <br />
                    Example:
                    <br />
                    IP Address | License
                    <br />
                    192.168.1.10 | ABC123456789
                    <br />
                    192.168.1.11 | XYZ987654321
                </span>
            </div>
        </div>
    );
};

export default LicenseActivation;