import React, { useState, useEffect } from 'react';
import {
  Breadcrumb,
  Button,
  Checkbox,
  Divider,
  Flex,
  Input,
  Radio,
  Select,
  Table,
  Typography,
  Form,
  Space,
  Tooltip,
  message,
  Spin
} from 'antd';
import { HomeOutlined, CloudOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Splitter } from 'antd';
import axios from 'axios';

const hostIP = window.location.hostname;
const { Option } = Select;
const ipRegex = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/;
const subnetRegex = /^(255|254|252|248|240|224|192|128|0+)\.((255|254|252|248|240|224|192|128|0+)\.){2}(255|254|252|248|240|224|192|128|0+)$/;

const getCloudName = () => {
  const fromSession = sessionStorage.getItem('cloudName');
  if (fromSession) return fromSession;
  const meta = document.querySelector('meta[name="cloud-name"]');
  return meta ? meta.content : null; // Return the content of the meta tag
};




const Deployment = ({ next }) => {
  const cloudName = getCloudName();
  const [configType, setConfigType] = useState('default');
  const [tableData, setTableData] = useState([]);
  const [useBond, setUseBond] = useState(false);
  const [Providerform] = Form.useForm();
  const [Tenantform] = Form.useForm();
  const [vipform] = Form.useForm();
  const [interfaces, setInterfaces] = useState([]);
  const [disks, setDisks] = useState([]);
  const [loading, setLoading] = useState(false);




  // Use refs to expose fetchers for button without hoisting
  const fetchInterfacesRef = React.useRef(null);
  const fetchDisksRef = React.useRef(null);

  useEffect(() => {
    const fetchInterfaces = async () => {
      try {
        const response = await axios.get(`https://${hostIP}:2020/get-interfaces`);
        if (response.data?.interfaces) {
          setInterfaces(response.data.interfaces);
        } else {
          console.warn('No interfaces found in response');
        }
      } catch (error) {
        console.error('Error fetching interfaces:', error);
      }
    };

    const fetchDisks = async () => {
      try {
        const response = await axios.get(`https://${hostIP}:2020/get-disks`);
        const allDisks = response.data.disks || [];
        const uniqueDisks = Array.from(
          new Map(allDisks.map(d => [d.name, d])).values()
        );
        setDisks(uniqueDisks);
      } catch (error) {
        console.error('Failed to fetch disks:', error);
      }
    };

    fetchInterfacesRef.current = fetchInterfaces;
    fetchDisksRef.current = fetchDisks;

    fetchInterfaces();
    fetchDisks();
  }, []);

  const handleSubmit = async () => {
    setLoading(true); // Start loading spinner
    let validationFailed = false;
    try {
      // 1. Validate VIP form
      const vipValues = await vipform.validateFields();

      if (configType === 'segregated' && !vipValues.defaultGateway) {
        message.error('Default Gateway is required in segregated mode.');
        setLoading(false);
        validationFailed = true;
        return;
      }

      // 2. Validate Table Rows
      for (let i = 0; i < tableData.length; i++) {
        const row = tableData[i];

        // Bond: must select 2 interfaces
        if (!row.interface || (useBond && row.interface.length !== 2)) {
          message.error(`Row ${i + 1}: Please select ${useBond ? 'exactly two' : 'a'} interface${useBond ? 's' : ''}.`);
          setLoading(false);
          validationFailed = true;
          return;
        }

        // Must select Type
        if (!row.type || (Array.isArray(row.type) && row.type.length === 0)) {
          message.error(`Row ${i + 1}: Please select a Type.`);
          setLoading(false);
          validationFailed = true;
          return;
        }

        // If bond is enabled, Bond Name is required
        if (useBond && !row.bondName?.trim()) {
          message.error(`Row ${i + 1}: Please enter a Bond Name.`);
          setLoading(false);
          validationFailed = true;
          return;
        }

        // Skip field validation for 'secondary' in default mode
        const isSecondaryInDefault = configType === 'default' && row.type === 'secondary';
        if (!isSecondaryInDefault) {
          const requiredFields = ['ip', 'subnet', 'dns']; // gateway removed
          for (const field of requiredFields) {
            if (!row[field]) {
              message.error(`Row ${i + 1}: Please enter ${field.toUpperCase()}.`);
              setLoading(false);
              validationFailed = true;
              return;
            }
          }
        }

        // Check for inline validation errors
        if (Object.keys(row.errors || {}).length > 0) {
          message.error(`Row ${i + 1} contains invalid entries. Please fix them.`);
          setLoading(false);
          validationFailed = true;
          return;
        }
      }

      // 3. Validate Provider Network
      const providerValues = Providerform.getFieldsValue();
      const providerFields = ['cidr', 'gateway', 'startingIp', 'endingIp'];
      const providerTouched = providerFields.some((field) => !!providerValues[field]);
      if (providerTouched) {
        for (const field of providerFields) {
          if (!providerValues[field]) {
            message.error(`Provider Network: Please fill in the ${field} field.`);
            setLoading(false);
            validationFailed = true;
            return;
          }
        }
      }

      // 4. Validate Tenant Network
      const tenantValues = Tenantform.getFieldsValue();
      const tenantFields = ['cidr', 'gateway', 'nameserver'];
      const tenantTouched = tenantFields.some((field) => !!tenantValues[field]);
      if (tenantTouched) {
        for (const field of tenantFields) {
          if (!tenantValues[field]) {
            message.error(`Tenant Network: Please fill in the ${field} field.`);
            setLoading(false);
            validationFailed = true;
            return;
          }
        }
      }

      // ✅ All validations passed
      // Store VIP and Server IP in sessionStorage
      const vipSessionValue = vipform.getFieldValue("vip");
      if (vipSessionValue) {
        sessionStorage.setItem("vip", vipSessionValue);
      }
      // --- Store server IP ---
      let serverIp = null;
      if (configType === 'default') {
        // Find row with type 'primary'
        const primaryRow = tableData.find(row => row.type === 'primary');
        if (primaryRow && primaryRow.ip) serverIp = primaryRow.ip;
      } else if (configType === 'segregated') {
        // Find row with type including 'Management'
        const mgmtRow = tableData.find(row => Array.isArray(row.type) && row.type.includes('Management'));
        if (mgmtRow && mgmtRow.ip) serverIp = mgmtRow.ip;
      }
      if (serverIp) {
        sessionStorage.setItem("server_ip", serverIp);
      }
    // --- Store network role IPs (Management, External_Traffic, Storage, VXLAN) ---
    const roleTypes = [
      { key: 'Management', label: 'Management' },
      { key: 'External_Traffic', label: 'External Traffic' },
      { key: 'Storage', label: 'Storage' },
      { key: 'VXLAN', label: 'VXLAN' },
    ];
    roleTypes.forEach(({ key, label }) => {
      // For each row, if type matches (can be string or array), collect IP
      let ips = tableData
        .filter(row => {
          if (Array.isArray(row.type)) {
            return row.type.includes(label);
          } else {
            return row.type === label;
          }
        })
        .map(row => row.ip)
        .filter(ip => !!ip);
      if (ips.length > 0) {
        sessionStorage.setItem(key, ips.join(','));
      } else {
        sessionStorage.removeItem(key); // Clean up if not present
      }
    });

    // --- Now create deployment activity log after sessionStorage is fully updated ---
    const loginDetails = JSON.parse(sessionStorage.getItem('loginDetails'));
    const userData = loginDetails?.data;
    const user_id = userData?.id;
    const username = userData?.companyName;
    const server_ip = sessionStorage.getItem('server_ip');
    if (!user_id || !username || !cloudName || !server_ip) {
      message.error('Missing required fields for deployment log');
      setLoading(false);
      validationFailed = true;
      return;
    }
    let backendError = false;
    // Normalize license details in sessionStorage
    const licenseStatusRaw = sessionStorage.getItem('licenseStatus') || '{}';
    const licenseStatus = JSON.parse(licenseStatusRaw);
    const licenseTypeStr = String(licenseStatus?.type || '').toLowerCase();
    const isPerpetual = licenseTypeStr === 'perpetual' || licenseTypeStr === 'perpectual';
    // If already marked activated, ensure frontend stores start_date today and end_date null
    if (String(licenseStatus?.status || '').toLowerCase() === 'activated') {
      const today = new Date().toISOString().split('T')[0];
      sessionStorage.setItem('licenseStatus', JSON.stringify({
        ...licenseStatus,
        period: isPerpetual ? null : (licenseStatus?.period ?? null),
        start_date: today,
        end_date: null,
      }));
    }
    try {
      const res = await fetch(`https://${hostIP}:5000/api/deployment-activity-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id,
          username,
          cloudname: cloudName || sessionStorage.getItem('cloudName') || cloudName,
          serverip: server_ip,
          license_code: licenseStatus?.license_code || null,
          license_type: licenseStatus?.type || null,
          license_period: isPerpetual ? null : (licenseStatus?.period || null),
          vip: sessionStorage.getItem('vip') || null,
          Management: sessionStorage.getItem('Management') || null,
          External_Traffic: sessionStorage.getItem('External_Traffic') || null,
          Storage: sessionStorage.getItem('Storage') || null,
          VXLAN: sessionStorage.getItem('VXLAN') || null
        })
      });
      const data = await res.json();
      if (res.ok && data.serverid) {
        sessionStorage.setItem('currentServerid', data.serverid);
      } else {
        message.error(data.message || 'Error logging deployment activity');
        backendError = true;
        validationFailed = true;
        return;
      }
    } catch (e) {
      message.error('Error logging deployment activity');
      backendError = true;
      validationFailed = true;
      return;
    } finally {
      if (backendError) setLoading(false);
    }

    // Build submission payload and send to backend
    const ls = JSON.parse(sessionStorage.getItem('licenseStatus') || '{}');
    const lsType = String(ls?.type || '').toLowerCase();
    const lsPerpetual = lsType === 'perpetual' || lsType === 'perpectual';

    const rawData = {
      tableData,
      configType,
      useBond,
      vip: vipform.getFieldValue('vip'),
      disk: vipform.getFieldValue('disk'),
      defaultGateway: vipform.getFieldValue('defaultGateway') || '',
      hostname: vipform.getFieldValue('hostname') || 'pinakasv',
      providerNetwork: providerValues,
      tenantNetwork: tenantValues,
      license_code: ls?.license_code || null,
      license_type: ls?.type || null,
      license_period: lsPerpetual ? null : (ls?.period || null),
    };

    await submitToBackend(rawData);
  } catch (error) {
    message.error('Please fix the errors in required fields.');
    setLoading(false);
    validationFailed = true;
    return;
  }

  // End of handleSubmit
};

  const submitToBackend = async (data) => {
    try {
      const response = await fetch(`https://${hostIP}:2020/submit-network-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (response.ok) {
        message.success('Data submitted successfully!');
        message.success('The Deployment will start in a moment');
        if (next) next();
      } else {
        message.error(`Error: ${result.message || 'Submission failed'}`);
        setLoading(false);
      }
    } catch (err) {
      message.error(`Server Error: ${err.message}`);
      setLoading(false);
    }
  };

  const formatSubmissionData = ({ tableData, configType, useBond, useVLAN, vipValues, providerValues, tenantValues, disk }) => {
    const payload = {
      using_interfaces: {},
      provider_cidr: providerValues?.cidr || 'N/A',
      provider_gateway: providerValues?.gateway || 'N/A',
      provider_startingip: providerValues?.startingIp || 'N/A',
      provider_endingip: providerValues?.endingIp || 'N/A',
      tenant_cidr: tenantValues?.cidr || '10.0.0.0/24',
      tenant_gateway: tenantValues?.gateway || '10.0.0.1',
      tenant_nameserver: tenantValues?.nameserver || '8.8.8.8',
      disk: vipValues?.disk || '',
      vip: vipValues?.vip || ''
    };

    if (configType === 'segregated' && vipValues?.defaultGateway) {
      payload.default_gateway = vipValues.defaultGateway;
    }

    let bondIndex = 1;
    let ifaceIndex = 1;

    for (const row of tableData) {
      const isBondRow = !!row.bondName;
      const isSecondary = row?.type?.includes('Secondary') || row?.type?.includes('External_Traffic');

      if (isBondRow) {
        const bondKey = `bond${bondIndex++}`;
        payload.using_interfaces[bondKey] = {
          interface_name: row.bondName,
          type: row.type,
          vlan_id: useVLAN ? row.vlan_id : 'NULL',
          ...(isSecondary ? {} : {
            Properties: {
              IP_ADDRESS: row.ip,
              Netmask: row.subnet,
              DNS: row.dns,
              gateway: row.gateway,
            },
          }),
        };
      } else {
        const ifaceKey = `interface_${ifaceIndex.toString().padStart(2, '0')}`;
        ifaceIndex++;
        payload.using_interfaces[ifaceKey] = {
          interface_name: row.interface,
          Bond_Slave: useBond ? 'YES' : 'NO',
          ...(useBond && { Bond_Interface_Name: row.bondName || '' }),
        };

        if (!useBond) {
          payload.using_interfaces[ifaceKey] = {
            ...payload.using_interfaces[ifaceKey],
            type: row.type,
            vlan_id: useVLAN ? row.vlan_id : 'NULL',
            ...(isSecondary ? {} : {
              Properties: {
                IP_ADDRESS: row.ip,
                Netmask: row.subnet,
                DNS: row.dns,
                gateway: row.gateway,
              },
            }),
          };
        }
      }
    }

    return payload;
  };

  // Generate rows based on selected config type
  const generateRows = (count) =>
    Array.from({ length: count }, (_, i) => ({
      key: i,
      ip: '',
      subnet: '',
      dns: '',
      gateway: '',
      errors: {}
    }));


  // Update table rows when config type changes
  const getRowCount = React.useCallback(() => {
    if (configType === 'default') {
      return useBond ? 2 : 2;
    } else if (configType === 'segregated') {
      return useBond ? 4 : 4;
    }
    return 2;
  }, [configType, useBond]);

  useEffect(() => {
    const rows = generateRows(getRowCount());
    setTableData(rows);
  }, [configType, useBond, getRowCount]);


  const handleReset = () => {
    setTableData(generateRows(getRowCount()));
  };

  const handleCellChange = (index, field, value) => {
    const updatedData = [...tableData];
    const row = updatedData[index];

    if (!row.errors) row.errors = {};

    if (field === 'type' && configType === 'default') {
      row.type = value;

      const otherIndex = index === 0 ? 1 : 0;
      const otherRow = updatedData[otherIndex];

      if (value === 'primary') {
        otherRow.type = 'secondary';
      } else if (value === 'secondary') {
        otherRow.type = 'primary';
      }

      updatedData[otherIndex] = otherRow;
    } else {
      row[field] = value;

      // Validation for IP/DNS/Gateway
      if (["ip", "dns", "gateway"].includes(field)) {
        if (!ipRegex.test(value)) {
          row.errors[field] = 'Should be a valid address';
        } else {
          // Duplicate IP check for segregated mode
          if (field === "ip" && configType === "segregated") {
            const isDuplicate = updatedData.some((r, i) => i !== index && r.ip === value && value);
            if (isDuplicate) {
              row.errors.ip = 'Duplicate IP address in another row';
            } else {
              delete row.errors.ip;
            }
          } else {
            delete row.errors[field];
          }
        }
      }

      // Validation for subnet
      if (field === 'subnet') {
        if (!subnetRegex.test(value)) {
          row.errors[field] = 'Invalid subnet format';
        } else {
          delete row.errors[field];
        }
      }

      if (field === 'interface') {
        // For bonding, limit to max 2 interfaces
        if (useBond && value.length > 2) {
          value = value.slice(0, 2);
        }

        row.interface = value;
      }

      if (field === 'bondName') {
        // Ensure bond name is unique
        const isDuplicate = updatedData.some((r, i) => i !== index && r.bondName === value);
        if (isDuplicate) {
          row.errors[field] = 'Bond name must be unique';
        } else {
          delete row.errors[field];
        }
      }
    }

    updatedData[index] = row;
    setTableData(updatedData);
  };

  const getColumns = () => {
    const baseColumns = [
      {
        title: 'SL.NO',
        key: 'slno',
        render: (_, record, index) => <span>{index + 1}</span>,
      },
    ];

    const bondColumn = {
      title: 'Bond Name',
      dataIndex: 'bondName',
      render: (_, record, index) => {
        const error = record.errors?.bondName;
        return (
          <div>
            <Input
              value={record.bondName ?? ''}
              placeholder="Enter Bond Name"
              status={error ? 'error' : ''}
              onChange={(e) => handleCellChange(index, 'bondName', e.target.value)}
            />
            {error && <div style={{ color: 'red', fontSize: 12 }}>{error}</div>}
          </div>
        );
      },
    };

    const vlanColumn = {
      title: 'VLAN ID',
      dataIndex: 'vlanId',
      render: (_, record, index) => (
        <Tooltip placement='right' title="VLAN ID (1-4094, optional)">
          <Input
            value={record.vlanId ?? ''}
            placeholder="Enter VLAN ID (optional)"
            onChange={(e) => {
              const value = e.target.value;
              // 1) Allow only digits
              if (!/^[0-9]*$/.test(value)) return;
              // 2) Allow max 4 digits
              if (value.length > 4) return;
              // 3) Allow only range 1–4094 when value is not empty
              if (value && (Number(value) < 1 || Number(value) > 4094)) return;
              // All checks passed ➔ call the handler
              handleCellChange(index, 'vlanId', value);
            }}
          />
        </Tooltip>
      ),
    };

    const mainColumns = [
      {
        title: 'Interfaces Required',
        dataIndex: 'interface',
        render: (_, record, index) => {
          const selectedInterfaces = tableData
            .filter((_, i) => i !== index)
            .flatMap(row => {
              if (useBond && Array.isArray(row.interface)) return row.interface;
              if (!useBond && row.interface) return [row.interface];
              return [];
            });

          const currentSelection = useBond
            ? Array.isArray(record.interface) ? record.interface : []
            : record.interface ? [record.interface] : [];

          const availableInterfaces = interfaces.filter(
            (iface) =>
              !selectedInterfaces.includes(iface.iface) || currentSelection.includes(iface.iface)
          );

          return (
            <Select
              mode={useBond ? 'multiple' : undefined}
              style={{ width: '100%' }}
              value={record.interface}
              allowClear
              placeholder={useBond ? 'Select interfaces' : 'Select interface'}
              onChange={(value) => {
                if (useBond && Array.isArray(value) && value.length > 2) {
                  value = value.slice(0, 2);
                }
                handleCellChange(index, 'interface', value);
              }}
              maxTagCount={2}
            >
              {availableInterfaces.map((ifaceObj) => (
                <Option key={ifaceObj.iface} value={ifaceObj.iface}>
                  {ifaceObj.iface}
                </Option>
              ))}
            </Select>
          );
        },
      },
      {
        title: 'Type',
        dataIndex: 'type',
        render: (_, record, index) => {
          // --- Restrict Management type in segregated mode ---
          let managementTaken = false;
          if (configType === 'segregated') {
            managementTaken = tableData.some((row, i) => i !== index && Array.isArray(row.type) && row.type.includes('Management'));
          }
          return (
            <Select
              mode={configType === 'segregated' ? 'multiple' : undefined}
              allowClear
              style={{ width: '100%' }}
              value={record.type}
              placeholder="Select type"
              onChange={(value) => handleCellChange(index, 'type', value)}
            >
              {configType === 'segregated' ? (
                <>
                  {!managementTaken || (Array.isArray(record.type) && record.type.includes('Management')) ? (
                    <Option value="Management">
                      <Tooltip placement="right" title="Mangement" >
                        Mgmt
                      </Tooltip>
                    </Option>
                  ) : null}
                  <Option value="VXLAN">
                    <Tooltip placement="right" title="VXLAN">
                      VXLAN
                    </Tooltip>
                  </Option>
                  <Option value="Storage">
                    <Tooltip placement="right" title="Storage">
                      Storage
                    </Tooltip>
                  </Option>
                  <Option value="External Traffic">
                    <Tooltip placement="right" title="External Traffic">
                      External Traffic
                    </Tooltip>
                  </Option>
                </>
              ) : (
                <>
                  <Option value="primary">
                    <Tooltip placement="right" title="Primary">
                      Primary
                    </Tooltip>
                  </Option>
                  <Option value="secondary">
                    <Tooltip placement="right" title="Secondary">
                      Secondary
                    </Tooltip>
                  </Option>
                </>
              )}
            </Select>
          );
        },
      },
      {
        title: 'IP ADDRESS',
        dataIndex: 'ip',
        render: (_, record, index) => (
          <Form.Item
            validateStatus={record.errors?.ip ? 'error' : ''}
            help={record.errors?.ip}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.ip}
              disabled={shouldDisableFields(record)}
              placeholder="Enter IP Address"
              onChange={(e) => handleCellChange(index, 'ip', e.target.value)}
            />
          </Form.Item>
        ),
      },
      {
        title: 'SUBNET MASK',
        dataIndex: 'subnet',
        render: (_, record, index) => (
          <Form.Item
            validateStatus={record.errors?.subnet ? 'error' : ''}
            help={record.errors?.subnet}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.subnet}
              disabled={shouldDisableFields(record)}
              placeholder="Enter Subnet"
              onChange={(e) => handleCellChange(index, 'subnet', e.target.value)}
            />
          </Form.Item>
        ),
      },
      {
        title: 'DNS Servers',
        dataIndex: 'dns',
        render: (_, record, index) => (
          <Form.Item
            validateStatus={record.errors?.dns ? 'error' : ''}
            help={record.errors?.dns}
            style={{ marginBottom: 0 }}
          >
            <Input
              value={record.dns}
              placeholder="Enter Nameserver"
              disabled={shouldDisableFields(record)}
              onChange={(e) => handleCellChange(index, 'dns', e.target.value)}
            />
          </Form.Item>
        ),
      },

    ];
    return [
      ...baseColumns,
      ...(useBond ? [bondColumn] : []),
      ...mainColumns,
      ...[vlanColumn],
    ];
  };


  return (
    <div style={{ padding: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        {/* <Breadcrumb>
          <Breadcrumb.Item>
            <HomeOutlined />
          </Breadcrumb.Item>
          <Breadcrumb.Item>Deployment Options</Breadcrumb.Item>
          <Breadcrumb.Item>Validation</Breadcrumb.Item>
          <Breadcrumb.Item>System Interfaces</Breadcrumb.Item>
          <Breadcrumb.Item>License Activation</Breadcrumb.Item>
          <Breadcrumb.Item>Deployment</Breadcrumb.Item>
        </Breadcrumb> */}
        <h4 style={{marginBottom: "9px", marginTop: "3px"}}>
          Cloud Name: <span style={{ color: "blue" }}>{cloudName}</span>
        </h4>
      </div>

      <Divider style={{ marginBottom: "18px",marginTop: "19px" }}/>
      <h4 style={{ userSelect: "none" }}>Network Configuration</h4>
      <div style={{ height: '830px' }}>
        <Spin
          spinning={loading}
          tip="Validating the input..."
          size="large"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '230px',
          }}
        >
          <div>
            <Splitter
              style={{
                height: 150,
                boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)',
              }}
            >
              <Splitter.Panel size="50%" resizable={false}>
                <div style={{ padding: 20 }}>
                  <Typography.Title level={5} style={{ marginBottom: 16 }}>
                    Configuration Type
                  </Typography.Title>
                  <Radio.Group
                    value={configType}
                    onChange={(e) => setConfigType(e.target.value)}
                  >
                    <Flex vertical gap="small">
                      <Radio value="default">Default</Radio>
                      <Radio value="segregated">Segregated</Radio>
                    </Flex>
                  </Radio.Group>
                </div>
              </Splitter.Panel>

              <Splitter.Panel resizable={false}>
                <div style={{ padding: 20 }}>
                  <Typography.Title level={5} style={{ marginBottom: 16 }}>
                    Advanced Networking Options
                  </Typography.Title>
                  <Flex vertical gap="small">

                    <Checkbox checked={useBond} onChange={(e) => setUseBond(e.target.checked)}>BOND</Checkbox>
                  </Flex>
                </div>
              </Splitter.Panel>
            </Splitter>

            <Flex justify="flex-end" style={{ margin: '16px 0' }}>
              <Button color="primary" variant="text" onClick={() => {
                if (fetchInterfacesRef.current) fetchInterfacesRef.current();
                if (fetchDisksRef.current) fetchDisksRef.current();
              }} style={{ marginRight: 8, width: "100px", height: "35px" }}>
                Refetch Data
              </Button>
              <Button type="text" danger onClick={handleReset} style={{ width: "100px", height: "35px" }}>
                Reset Table
              </Button>
            </Flex>

            <div style={{ marginTop: 24, height: 200, overflowY: 'auto' }}>
              <Table
                columns={getColumns()}  // ← dynamic columns logic goes here
                dataSource={tableData}
                pagination={false}
                bordered
                size="small"
                scroll={{ x: true }}
              />
            </div>
            <Divider />
            <Form form={vipform} layout="vertical">
              <div style={{ display: "flex", gap: "40px", marginTop: "20px" }}>
                <Form.Item
                  name="vip"
                  label={
                    <span>
                      Enter VIP&nbsp;
                      <Tooltip placement="right" title="Virtual IP Address" >
                        <InfoCircleOutlined style={{
                          color: "#1890ff", fontSize: "14px", height: "12px",
                          width: "12px"
                        }} />
                      </Tooltip>
                    </span>
                  }
                  rules={[
                    { required: true, message: 'VIP is required' },
                    {
                      pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                      message: 'Invalid VIP format (e.g. 192.168.1.0)',
                    },
                  ]}
                >
                  <Input maxLength={18} placeholder="Enter VIP" style={{ width: 200 }} />
                </Form.Item>

                <Form.Item
                  name="disk"
                  label={
                    <span>
                      Select Disks&nbsp;
                      <Tooltip placement="right" title="Ceph OSD">
                        <InfoCircleOutlined
                          style={{
                            color: "#1890ff",
                            fontSize: "14px",
                            height: "12px",
                            width: "12px",
                          }}
                        />
                      </Tooltip>
                    </span>
                  }
                  rules={[{ required: true, message: 'Disk is required' }]}
                >
                  <Select
                    placeholder="Select Disk"
                    style={{ width: 200 }}
                    allowClear
                    mode="multiple"
                    optionLabelProp="label"
                  >
                    {disks.map((disk) => (
                      <Option key={disk.wwn} value={disk.wwn} label={disk.name}>
                        <div>
                          <strong>{disk.name}</strong> &nbsp;
                          <span style={{ color: '#888' }}>
                            ({disk.size}, WWN: {disk.wwn || 'N/A'})
                          </span>
                        </div>
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item
                  name="defaultGateway"
                  label={
                    <span>
                      Enter Default Gateway&nbsp;
                      <Tooltip placement="right" title="Default Gateway">
                        <InfoCircleOutlined
                          style={{
                            color: "#1890ff",
                            fontSize: "14px",
                            height: "12px",
                            width: "12px"
                          }}
                        />
                      </Tooltip>
                    </span>
                  }
                  rules={[
                    { required: true, message: 'Gateway is required' },
                    {
                      pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                      message: 'Invalid IP format (e.g. 192.168.1.1)',
                    },
                  ]}
                >
                  <Input maxLength={18} placeholder="Enter Gateway" style={{ width: 200 }} />
                </Form.Item>

                <Form.Item
                  name="hostname"
                  label={
                    <span>
                      Enter Hostname&nbsp;
                      <Tooltip placement="right" title="This is the hostname for the deployed host. Optional; defaults to 'pinakasv'.">
                        <InfoCircleOutlined
                          style={{
                            color: "#1890ff",
                            fontSize: "14px",
                            height: "12px",
                            width: "12px"
                          }}
                        />
                      </Tooltip>
                    </span>
                  }
                  initialValue="pinakasv"
                  rules={[]}
                >
                  <Input maxLength={32} placeholder="Enter Hostname (optional)" style={{ width: 200 }} />
                </Form.Item>
              </div>
            </Form>
            <Divider />
            <div
              style={{
                display: "flex",
                alignItems: "center", // ✅ This ensures vertical alignment
                marginTop: "20px",
                marginBottom: "5px",
                gap: "7px"
              }}
            >
              <h4 style={{ userSelect: "none", margin: 0 }}>Provider Network</h4>
              <p style={{ margin: 0 }}>(optional)</p>
              <Tooltip placement="right" title="Provider Network" >
                <InfoCircleOutlined
                  style={{
                    color: "#1890ff",
                    fontSize: "15.5px",
                    height: "12px",
                    width: "12px"
                  }}
                />
              </Tooltip>
            </div>
            <Form form={Providerform} >
              <Space>
                <div style={{ display: "flex", gap: "40px" }}>
                  <Form.Item
                    name="cidr"
                    rules={[
                      // {
                      //   required: true,
                      //   message: 'CIDR is required',
                      // },
                      {
                        pattern: /^(([0-9]{1,3}\.){3}[0-9]{1,3})\/([0-9]|[1-2][0-9]|3[0-2])$/,
                        message: 'Invalid CIDR format (e.g. 192.168.1.0/24)',
                      },
                    ]}
                  >
                    <Input placeholder="Enter CIDR" style={{ width: 200 }} />
                  </Form.Item>

                  <Form.Item
                    name="gateway"
                    rules={[
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                        message: 'Invalid IP address',
                      },
                    ]}
                  >
                    <Input placeholder="Enter Gateway" style={{ width: 200 }} />
                  </Form.Item>

                  <Form.Item
                    name="startingIp"
                    rules={[
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                        message: 'Invalid IP address',
                      },
                    ]}
                  >
                    <Input placeholder="Enter Starting IP" style={{ width: 200 }} />
                  </Form.Item>

                  <Form.Item
                    name="endingIp"
                    rules={[
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                        message: 'Invalid IP address',
                      },
                    ]}
                  >
                    <Input placeholder="Enter Ending IP" style={{ width: 200 }} />
                  </Form.Item>
                </div>
              </Space>
            </Form >
            <Divider />
            <div
              style={{
                display: "flex",
                alignItems: "center", // ✅ This ensures vertical alignment
                marginTop: "20px",
                marginBottom: "8px",
                gap: "7px"
              }}
            >
              <h4 style={{ userSelect: "none", margin: 0 }}>Tenant Network</h4>
              <p style={{ margin: 0 }}>(optional)</p>
              <Tooltip placement="right" title="Tenant Network" >
                <InfoCircleOutlined
                  style={{
                    color: "#1890ff",
                    fontSize: "15.5px",
                    height: "12px",
                    width: "12px"
                  }}
                />
              </Tooltip>
            </div>
            <Form form={Tenantform} layout="vertical">
              <Space>
                <div style={{ display: "flex", gap: "40px" }}>
                  {/* CIDR Field */}
                  <Form.Item
                    name="cidr"
                    rules={[
                      // { required: true, message: 'CIDR is required' },
                      {
                        pattern: /^(([0-9]{1,3}\.){3}[0-9]{1,3})\/([0-9]|[1-2][0-9]|3[0-2])$/,
                        message: 'Invalid CIDR format (e.g. 10.0.0.0/24)',
                      },
                    ]}
                  >
                    <Input
                      placeholder="CIDR default:10.0.0.0/24"
                      style={{ width: 200 }}
                    />
                  </Form.Item>

                  {/* Gateway Field */}
                  <Form.Item
                    name="gateway"
                    rules={[
                      // { required: true, message: 'Gateway is required' },
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                        message: 'Invalid Gateway IP (e.g. 10.0.0.1)',
                      },
                    ]}
                  >
                    <Input
                      placeholder="Gateway default:10.0.0.1"
                      style={{ width: 200 }}
                    />
                  </Form.Item>

                  {/* Nameserver Field */}
                  <Form.Item
                    name="nameserver"
                    rules={[
                      // { required: true, message: 'Nameserver is required' },
                      {
                        pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.|$)){4}$/,
                        message: 'Invalid Nameserver IP (e.g. 8.8.8.8)',
                      },
                    ]}
                  >
                    <Input
                      placeholder="Nameserver default:8.8.8.8"
                      style={{ width: 200 }}
                    />
                  </Form.Item>
                </div>
              </Space>
            </Form>
            <Flex justify="flex-end">
              <Space>
                <Button htmlType="button" danger onClick={() => {
                  vipform.resetFields();
                  Providerform.resetFields();
                  Tenantform.resetFields();
                  handleReset(); // resets the table
                }}>
                  Reset Values
                </Button>
                <Button type="primary" onClick={handleSubmit}>
                  Submit
                </Button>
              </Space>
            </Flex>
          </div>
        </Spin>
      </div>
    </div >
  );
};


export default Deployment;