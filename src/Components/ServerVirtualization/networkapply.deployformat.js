// Formatter for deployment config files (for /store-deployment-configs)
// Produces output matching the user's required formats (Default, Default+Bond, Segregated, Segregated+Bond)

export function buildDeployConfigPayload(form) {
  // Extract relevant fields from form
  const { configType, useBond, tableData, hostname, selectedDisks, selectedRoles } = form;
  const using_interfaces = {};
  let ifaceCount = 1;

  // Helper to get interface key
  const ifaceKey = () => `interface_0${ifaceCount++}`;

  // Map table rows to using_interfaces
  tableData.forEach(row => {
    // Compose type array with proper mapping
    let typeArr = Array.isArray(row.type) ? row.type : (row.type ? [row.type] : []);
    typeArr = typeArr.map(t => {
      // Map interface types to required formats
      const lowerT = t.toLowerCase();
      
      // Management type mappings (case insensitive)
      if (lowerT === 'management' || lowerT === 'mgmt') return 'Mgmt';
      
      // External_Traffic type mappings (case insensitive)
      if (lowerT === 'external_traffic' || lowerT === 'external traffic' || lowerT === 'externaltraffic') return 'External_Traffic';
      
      // Other type mappings
      if (lowerT === 'vxlan') return 'VXLAN';
      if (lowerT === 'storage') return 'Storage';
      if (lowerT === 'primary') return 'Primary';
      if (lowerT === 'secondary') return 'Secondary';
      
      // Exact matches (preserve original case for already correct formats)
      if (t === 'Mgmt') return 'Mgmt';
      if (t === 'VXLAN') return 'VXLAN';
      if (t === 'External_Traffic') return 'External_Traffic';
      if (t === 'Storage') return 'Storage';
      if (t === 'Primary') return 'Primary';
      if (t === 'Secondary') return 'Secondary';
      
      return t;
    });
    const ifaceObj = {
      interface_name: row.bondName && useBond ? row.bondName : (Array.isArray(row.interface) ? row.interface[0] : row.interface),
      type: typeArr
    };
    // Only include ip for non-Secondary
    if (!(typeArr.length === 1 && typeArr[0] === 'Secondary')) {
      ifaceObj.ip = row.ip || '';
    }
    using_interfaces[ifaceKey()] = ifaceObj;
  });

  // Compose output object
  const out = {
    using_interfaces,
    hostname: hostname && hostname.trim() ? hostname : 'pinakasv',
    disk: selectedDisks || [],
    roles: selectedRoles || []
  };
  // Do NOT include top-level ip field
  return out;
}
