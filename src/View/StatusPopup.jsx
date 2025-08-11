import React from 'react';
import styles from "../Styles/StatusPopup.module.css";

const StatusPopup = ({ isVisible, statusMessages, onClose }) => {
    if (!isVisible) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.popup}>
                <div className={styles.header}>
                    <h3>Status</h3>
                    <button className={styles.closeButton} onClick={onClose}>✕</button>
                </div>
                <ul>
                    {statusMessages.map((msg, index) => (
                        <li key={index} className={styles[`${msg.type}-message`]}>
                            <span className={msg.type === 'success' ? styles['tick'] : styles['error']}></span> 
                            {msg.text}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default StatusPopup;
