import { createBrowserRouter } from "react-router-dom";
import App from "../App";
import Login from "../View/Login"; // Assuming there's a login page
import ErrorPageContainer from "../View/ErrorPageContainer";
import Siem from "../View/Siem";
import Iaas from "../View/Iaas";
import ServerVirtualization from "../View/ServerVirtualization.jsx"
import Dashboard from "../View/Dashboard";
import Addnode from "../View/Addnode";
import EdgeCloud from "../View/EdgeCloud";
import AiWorkbench from "../View/AiWorkbench";
import Noc from "../View/Noc";
import Lifecyclemgmt from "../View/Lifecyclemgmt";
import Migration from "../View/Migration";
import Compliance from "../View/Compliance";
import Setting from "../View/Setting";
import Administration from "../View/Administration";
import Vdi from "../View/Vdi";
import Hpc from "../View/Hpc";
import Marketplace from "../View/Marketplace";
import Inventory from "../View/Inventory";
import DistributedStorage from "../View/DistributedStorage";


// Public routes (e.g., Login and Signup)
const publicRoutes = [
  
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/*", 
    element: <ErrorPageContainer />, 
  },
];

// Authenticated routes
const authenticatedRoutes = [
  {
    path: "/",
    element: <App />,
    errorElement: <ErrorPageContainer />,
    children: [
      {
        path: "/",
        element: <Dashboard />,
      },
      {
        path: "/servervirtualization",
        element: <ServerVirtualization />,
      },
      {
        path: "/iaas",
        element: <Iaas />,
      },
      {
        path: "/inventory",
        element: <Inventory />,
      },
      {
        path: "/aiworkbench",
        element: <AiWorkbench />,
      },
      {
        path: "/siem",
        element: <Siem />,
      },
      {
        path: "/vdi",
        element: <Vdi />,
      },
      {
        path: "/hpc",
        element: <Hpc />,
      },
      {
        path: "/noc",
        element: <Noc />,
      },
      {
        path: "/marketplace",
        element: <Marketplace />,
      },
      {
        path: "/lifecyclemgmt",
        element: <Lifecyclemgmt />,
      },
      {
        path: "/migration",
        element: <Migration />,
      },
      {
        path: "/compliance",
        element: <Compliance />,
      },
      {
        path: "/setting",
        element: <Setting />,
      },
      {
        path: "/administration",
        element: <Administration />,
      },
      {
        path: "/addnode",
        element: <Addnode />,
      },
      {
        path: "/edgecloud",
        element: <EdgeCloud />,
      },
      {
	path: "/distributedstorage",
	element: <DistributedStorage />
      },
    ],
  },
  {
    path: "/*", // Catch-all for invalid URLs in authenticated context
    element: <ErrorPageContainer />, // Shows the 404 error page
  },
];

export const router = createBrowserRouter([
  ...publicRoutes,
  ...authenticatedRoutes,
]);
