import { useEffect, useState } from 'react';
import { Outlet } from "react-router-dom";
import Login from './View/Login';

const App = () => {
    const [isLogin, setIsLogin] = useState(false);

    useEffect(() => {
        const accessToken = sessionStorage.getItem('accessToken'); // Check access token instead of loginDetails
        if (accessToken) {
            setIsLogin(true);
        } else {
            setIsLogin(false);
        }
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

