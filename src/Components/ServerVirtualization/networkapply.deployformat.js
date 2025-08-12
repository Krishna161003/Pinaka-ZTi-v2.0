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
    // Compose type array (capitalize for consistency)
    let typeArr = Array.isArray(row.type) ? row.type : (row.type ? [row.type] : []);
    typeArr = typeArr.map(t => {
      if (t.toLowerCase() === 'primary') return 'Primary';
      if (t.toLowerCase() === 'secondary') return 'Secondary';
      if (t.toLowerCase() === 'mgmt' || t.toLowerCase() === 'management') return 'Mgmt';
      if (t.toLowerCase() === 'vxlan') return 'VXLAN';
      if (t.toLowerCase() === 'storage') return 'Storage';
      if (t.toLowerCase() === 'external traffic' || t.toLowerCase() === 'external_traffic') return 'External_Traffic';
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
