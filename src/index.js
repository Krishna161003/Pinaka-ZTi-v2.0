import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import reportWebVitals from './reportWebVitals';
import { RouterProvider } from 'react-router-dom';
import {router} from './router/index';
import './utils/sslCertInterceptors';
import SSLCertModal from './Components/SSLCertModal';


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <>
      <RouterProvider router={router}>  
      </RouterProvider>
      {/* Global SSL certificate acceptance helper */}
      <SSLCertModal />
    </>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
