// Formatter to convert form/table data to required backend JSON structure for network config
export function buildNetworkConfigPayload(form) {
  const { configType, useBond, tableData, defaultGateway, hostname } = form;
  const using_interfaces = {};
  let bondCount = 0;
  let ifaceCount = 1;
  
  // Helper to get interface key
  const ifaceKey = () => `interface_0${ifaceCount++}`;
  const bondKey = () => `bond${++bondCount}`;

  // Track bond names to bond keys
  const bondNameToKey = {};

  // Track if we've set the gateway for the first interface
  let isFirstInterface = true;

  // First, process all bond rows (if any)
  if (useBond) {
    tableData.forEach(row => {
      if (row.bondName && row.bondName.trim()) {
        const key = bondKey();
        bondNameToKey[row.bondName] = key;
        using_interfaces[key] = {
          interface_name: row.bondName,
          type: Array.isArray(row.type) ? row.type : (row.type ? [row.type] : []),
          vlan_id: row.vlanId || 'NULL',
        };
        // Only primary/management/storage/VXLAN gets Properties
        if (
          (configType === 'default' && row.type === 'primary') ||
          (configType === 'segregated' && Array.isArray(row.type) && row.type.length > 0 && !row.type.includes('External_Traffic'))
        ) {
          const properties = {
            IP_ADDRESS: row.ip || '',
            Netmask: row.subnet || '',
            DNS: row.dns || '',
            mtu: row.mtu || 'NULL'
          };
          
          // Only add gateway to the first interface that gets Properties
          if (isFirstInterface) {
            properties.gateway = defaultGateway || '';
            isFirstInterface = false; // Ensure only first interface gets the gateway
          }
          
          using_interfaces[key]["Properties"] = properties;
        }
        // Add all interfaces as Bond_Slave
        (Array.isArray(row.interface) ? row.interface : [row.interface]).forEach(iface => {
          if (iface) {
            const intKey = ifaceKey();
            using_interfaces[intKey] = {
              interface_name: iface,
              Bond_Slave: "YES",
              Bond_Interface_Name: row.bondName
            };
          }
        });
      }
    });
  }
  
  // Then, process all non-bond rows
  tableData.forEach(row => {
    // Skip bond rows if useBond
    if (useBond && row.bondName && row.bondName.trim()) return;
    const intKey = ifaceKey();
    const interface_name = Array.isArray(row.interface) ? row.interface[0] : row.interface;
    // Compose type array with proper mapping
    let typeArr = Array.isArray(row.type) ? row.type : (row.type ? [row.type] : []);
    typeArr = typeArr.map(t => {
      // Map interface types to required formats
      if (t === 'Mgmt') return 'Mgmt';
      if (t === 'VXLAN') return 'VXLAN';
      if (t === 'External_Traffic') return 'External_Traffic';
      return t;
    });
    using_interfaces[intKey] = {
      interface_name,
      type: typeArr,
      vlan_id: row.vlanId || 'NULL',
      Bond_Slave: "NO"
    };
    if (
      (configType === 'default' && typeArr.includes('primary')) ||
      (configType === 'default' && row.type === 'primary') ||
      (configType === 'segregated' && typeArr.length > 0 && !typeArr.includes('External_Traffic'))
    ) {
      const properties = {
        IP_ADDRESS: row.ip || '',
        Netmask: row.subnet || '',
        DNS: row.dns || '',
        mtu: row.mtu || 'NULL'
      };
      
      // Only add gateway to the first interface
      if (isFirstInterface) {
        properties.gateway = defaultGateway || '';
        isFirstInterface = false; // Ensure only first interface gets the gateway
      }
      
      using_interfaces[intKey]["Properties"] = properties;
    }
  });

  // Compose the full payload (minimal fields)
  return {
    using_interfaces,
    default_gateway: defaultGateway || '',
    hostname: (form.hostname && form.hostname.trim()) ? form.hostname : ''
  };
}