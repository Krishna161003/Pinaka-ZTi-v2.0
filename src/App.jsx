import { useEffect, useState } from 'react';
import axios from 'axios';
import { Outlet } from "react-router-dom";
import Login from './View/Login';

const App = () => {
    const [isLogin, setIsLogin] = useState(false);
    const hostIP = window.location.hostname;

    function isJwtNotExpired(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            const expSeconds = payload?.exp;
            if (!expSeconds || typeof expSeconds !== 'number') return false;
            const nowSeconds = Math.floor(Date.now() / 1000);
            return expSeconds > nowSeconds;
        } catch (_) {
            return false;
        }
    }

    useEffect(() => {
        const validate = async () => {
            const accessToken = sessionStorage.getItem('accessToken');
            if (!accessToken || !isJwtNotExpired(accessToken)) {
                sessionStorage.removeItem('accessToken');
                sessionStorage.removeItem('loginDetails');
                setIsLogin(false);
                return;
            }

            try {
                // Confirm token with Keycloak userinfo (ensures token not revoked)
                await axios.get(
                    `https://${hostIP}:9090/realms/zti-realm/protocol/openid-connect/userinfo`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                setIsLogin(true);
            } catch (_) {
                sessionStorage.removeItem('accessToken');
                sessionStorage.removeItem('loginDetails');
                setIsLogin(false);
            }
        };
        validate();
    }, []);

    function checkLogin(status) {
        setIsLogin(status);
    }

    return (
        <>
            {isLogin ? <Outlet /> : <Login checkLogin={checkLogin} />}
        </>
    );
};

export default App;

