import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../Components/sidebar';
import Footer from '../Components/footer';
import styles from "../Styles/DesignatedNode.module.css"; // Import CSS Modules

const DeploymentInfo = () => {
    const navigate = useNavigate();
    const [data, setData] = useState([]);
    const [selectedRow, setSelectedRow] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = () => {
        fetch('https://192.168.249.100:5000/get_data')  // Adjust URL based on your backend setup
            .then(response => response.json())
            .then(data => {
                setData(data);
            })
            .catch(error => {
                console.error('Error fetching data:', error);
            });
    };

    const handleCheckboxChange = (row) => {
        if (selectedRow && selectedRow.id === row.id) {
            setSelectedRow(null);
        } else {
            setSelectedRow(row);
        }
    };

    const handleDeploy = () => {
        if (!selectedRow) return;

        fetch('https://192.168.249.100:5000/deploy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(selectedRow),
        })
        .then(response => response.json())
        .then(data => {
            console.log('Deployment response:', data);
            // Handle response if needed
            navigate('/DesignatedNode');
        })
        .catch(error => {
            console.error('Error during deployment:', error);
            // Handle error if needed
        });
    };

    return (
        <div className={styles["data-table-container"]}>
            <h1>Deployment Info</h1>
            <div className={styles.container}>
                <div className={styles["data-table-container"]}>
                    <table className={styles["data-table"]}>
                        <thead>
                            <tr>
                                <th>Sl No.</th>
                                <th>IP Address</th>
                                <th>Hostname</th>
                                <th>Roles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, index) => (
                                <tr key={index}>
                                    <td>{row.slNo}</td>
                                    <td>{row.ipAddress}</td>
                                    <td>{row.hostname}</td>
                                    <td>{row.roles}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Sidebar />
                <Footer />
                <button
                    className={styles["button-deploy"]}
                    onClick={handleDeploy}
                    disabled={!selectedRow}
                >
                    Start Deploy
                </button>
            </div>
        </div>
    );
};

export default DeploymentInfo;
