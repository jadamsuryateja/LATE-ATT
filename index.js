document.addEventListener('DOMContentLoaded', function() {
    // Set current date
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', options);
    
    // Tab navigation
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
            
            if (tabId === 'history') {
                loadHistory();
            }
        });
    });
    
    // Scanner elements
    const cameraSelect = document.getElementById('camera-select');
    const startScannerBtn = document.getElementById('start-scanner');
    const videoElement = document.getElementById('scanner-video');
    const scannerView = document.getElementById('scanner-view');
    const scanStatus = document.getElementById('scan-status');
    const scanActions = document.getElementById('scan-actions');
    const confirmScanBtn = document.getElementById('confirm-scan');
    const cancelScanBtn = document.getElementById('cancel-scan');
    const attendanceSection = document.getElementById('attendance-section');
    const saveExcelBtn = document.getElementById('save-excel');
    const attendanceTable = document.getElementById('attendance-table').getElementsByTagName('tbody')[0];
    const barcodeResult = document.getElementById('barcode-result');
    
    // History elements
    const refreshHistoryBtn = document.getElementById('refresh-history');
    const clearHistoryBtn = document.getElementById('clear-history');
    const historyTable = document.getElementById('history-table').getElementsByTagName('tbody')[0];
    
    // Modal elements
    const renameModal = document.getElementById('rename-modal');
    const deleteModal = document.getElementById('delete-modal');
    const renameInput = document.getElementById('rename-input');
    const confirmRenameBtn = document.getElementById('confirm-rename');
    const cancelRenameBtn = document.getElementById('cancel-rename');
    const confirmDeleteBtn = document.getElementById('confirm-delete');
    const cancelDeleteBtn = document.getElementById('cancel-delete');
    const closeModalBtns = document.querySelectorAll('.close-modal');
    
    // Settings elements
    const saveSettingsBtn = document.getElementById('save-settings');
    const settingsStatus = document.getElementById('settings-status');
    
    let scannerActive = false;
    let currentScan = null;
    let attendanceData = [];
    let videoStream = null;
    let currentFileToRename = null;
    let currentFileToDelete = null;
    
    function getDepartmentFromRollNumber(rollNumber) {
        // Ensure the roll number is at least 10 characters long
        if (rollNumber.length < 10) return 'Unknown';
        
        // Extract department code from positions 6-7 (0-based index)
        const deptCode = rollNumber.substring(6, 8);
        
        switch(deptCode) {
            case '01': return 'Civil';
            case '02': return 'EEE';
            case '03': return 'Mech';
            case '04': return 'ECE';
            case '05': return 'CSE';
            case '12': return 'IT';
            case '42': return 'AIML';
            case '43': return 'AI';
            case '44': return 'DataScience';
            case '46': return 'CyberSecurity';
            default: return 'Unknown';
        }
    }
    // Initialize the application
    function init() {
        if (localStorage.getItem('attendanceData')) {
            attendanceData = JSON.parse(localStorage.getItem('attendanceData'));
            updateAttendanceTable();
        }
        
        loadHistory();
        loadSettings();
        initModals();
        getCameras();
        
        if (attendanceData.length > 0) {
            attendanceSection.classList.remove('hidden');
        }
    }
    
    // Initialize modals
    function initModals() {
        closeModalBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                renameModal.style.display = 'none';
                deleteModal.style.display = 'none';
            });
        });
        
        cancelRenameBtn.addEventListener('click', function() {
            renameModal.style.display = 'none';
        });
        
        cancelDeleteBtn.addEventListener('click', function() {
            deleteModal.style.display = 'none';
        });
        
        window.addEventListener('click', function(event) {
            if (event.target === renameModal) {
                renameModal.style.display = 'none';
            }
            if (event.target === deleteModal) {
                deleteModal.style.display = 'none';
            }
        });
        
        confirmRenameBtn.addEventListener('click', function() {
            if (currentFileToRename && renameInput.value.trim()) {
                const newName = renameInput.value.trim();
                if (!newName.endsWith('.xlsx')) {
                    renameInput.value = newName + '.xlsx';
                }
                renameFile(currentFileToRename, renameInput.value.trim());
                renameModal.style.display = 'none';
            }
        });
        
        confirmDeleteBtn.addEventListener('click', function() {
            if (currentFileToDelete) {
                deleteFile(currentFileToDelete);
                deleteModal.style.display = 'none';
            }
        });
    }
    
    // Get available cameras
    async function getCameras() {
        try {
            await navigator.mediaDevices.getUserMedia({ video: true });
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            
            if (videoDevices.length === 0) {
                cameraSelect.innerHTML = '<option value="">No cameras found</option>';
                startScannerBtn.disabled = true;
                scanStatus.textContent = 'Error: No cameras detected on this device.';
                scanStatus.className = 'status-message warning';
                return;
            }
            
            cameraSelect.innerHTML = '<option value="">Select Camera</option>';
            videoDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${cameraSelect.length}`;
                cameraSelect.appendChild(option);
            });
            
            const backCamera = videoDevices.find(device => 
                device.label.toLowerCase().includes('back') || 
                device.label.toLowerCase().includes('rear'));
            if (backCamera) {
                cameraSelect.value = backCamera.deviceId;
            }
        } catch (err) {
            console.error('Error enumerating devices:', err);
            cameraSelect.innerHTML = '<option value="">Camera access error</option>';
            startScannerBtn.disabled = true;
            
            if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                scanStatus.textContent = 'Error: Could not access camera. Please ensure:';
                scanStatus.textContent += '\n1. You are using HTTPS';
                scanStatus.textContent += '\n2. You granted camera permissions';
                scanStatus.textContent += '\n3. You are using Chrome or Firefox';
            } else {
                scanStatus.textContent = 'Error: Could not access camera devices. Please check permissions.';
            }
            
            scanStatus.className = 'status-message warning';
        }
    }
    
    // Initialize scanner
    function initScanner(cameraId) {
        const constraints = {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 },
            facingMode: cameraId && cameraId.includes('back') ? "environment" : "user"
        };
    
        navigator.mediaDevices.getUserMedia({ video: constraints })
            .then(function(stream) {
                videoStream = stream;
                videoElement.srcObject = stream;
                videoElement.play();
                
                Quagga.init({
                    inputStream: {
                        name: "Live",
                        type: "LiveStream",
                        target: videoElement,
                        constraints: constraints
                    },
                    decoder: {
                        readers: ["code_128_reader"]
                    },
                    locate: true,
                    numOfWorkers: navigator.hardwareConcurrency || 4
                }, function(err) {
                    if (err) {
                        console.error('Scanner initialization failed:', err);
                        scanStatus.textContent = 'Error: Could not initialize barcode scanner.';
                        
                        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                            scanStatus.textContent += ' Try switching between front and back cameras.';
                        }
                        
                        scanStatus.className = 'status-message warning';
                        scannerActive = false;
                        startScannerBtn.textContent = 'Start Scanner';
                        return;
                    }
                    
                    Quagga.start();
                    scannerActive = true;
                    startScannerBtn.textContent = 'Stop Scanner';
                    scannerView.classList.remove('hidden');
                    scanStatus.textContent = 'Scanner is active. Point camera at a barcode.';
                    scanStatus.className = 'status-message info';
                    
                    Quagga.onDetected(function(result) {
                        if (result.codeResult) {
                            const code = result.codeResult.code;
                            if (!currentScan || currentScan !== code) {
                                currentScan = code;
                                const department = getDepartmentFromRollNumber(code);
                                barcodeResult.textContent = `Scanned: ${code} (${department})`;
                                scanStatus.textContent = `ID: ${code} (${department}) detected. Confirm to add to attendance.`;
                                scanStatus.className = 'status-message success';
                                scanActions.classList.remove('hidden');
                                Quagga.stop();
                                
                                if (document.getElementById('enable-sound').checked) {
                                    playScanSound();
                                }
                                
                                if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                                    if (document.getElementById('enable-vibration').checked) {
                                        navigator.vibrate(200);
                                    }
                                }
                            }
                        }
                    });
                });
            })
            .catch(function(err) {
                console.error('Error accessing camera:', err);
                scanStatus.textContent = 'Error: Could not access camera. Please check permissions.';
                scanStatus.className = 'status-message warning';
                startScannerBtn.disabled = false;
                startScannerBtn.textContent = 'Start Scanner';
            });
    }
    
    // Play scan sound
    function playScanSound() {
        const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU...');
        audio.play().catch(e => console.log('Audio playback failed:', e));
    }
    
    // Stop scanner
    function stopScanner() {
        if (Quagga) {
            Quagga.stop();
        }
        
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
            videoStream = null;
        }
        
        scannerActive = false;
        startScannerBtn.textContent = 'Start Scanner';
        scannerView.classList.add('hidden');
        scanStatus.textContent = 'Scanner is inactive.';
        scanStatus.className = 'status-message warning';
        currentScan = null;
        barcodeResult.textContent = '';
    }
    
    // Toggle scanner
    startScannerBtn.addEventListener('click', function() {
        const selectedCameraId = cameraSelect.value;
        if (!selectedCameraId) {
            scanStatus.textContent = 'Please select a camera first.';
            scanStatus.className = 'status-message warning';
            return;
        }
        
        if (scannerActive) {
            stopScanner();
        } else {
            initScanner(selectedCameraId);
        }
    });
    
    // Camera selection change
    cameraSelect.addEventListener('change', function() {
        if (scannerActive) {
            stopScanner();
            initScanner(this.value);
        }
    });
    
    // Confirm scan
    confirmScanBtn.addEventListener('click', function() {
        if (!currentScan) return;
        
        const now = new Date();
        const dateString = now.toLocaleDateString();
        const timeString = now.toLocaleTimeString();
        const department = getDepartmentFromRollNumber(currentScan);
        
        if (attendanceData.some(entry => entry.id === currentScan)) {
            scanStatus.textContent = `ID ${currentScan} (${department}) already exists in the list.`;
            scanStatus.className = 'status-message warning';
            currentScan = null;
            scanActions.classList.add('hidden');
            barcodeResult.textContent = '';
            initScanner(cameraSelect.value);
            return;
        }
        
        attendanceData.push({
            id: currentScan,
            department: department,
            date: dateString,
            time: timeString
        });
        
        localStorage.setItem('attendanceData', JSON.stringify(attendanceData));
        updateAttendanceTable();
        
        scanStatus.textContent = `ID ${currentScan} (${department}) added. Scan next student.`;
        scanStatus.className = 'status-message info';
        currentScan = null;
        scanActions.classList.add('hidden');
        barcodeResult.textContent = '';
        attendanceSection.classList.remove('hidden');
        
        initScanner(cameraSelect.value);
    });
    
    // Cancel scan
    cancelScanBtn.addEventListener('click', function() {
        scanStatus.textContent = 'Scan canceled. Ready for next scan.';
        scanStatus.className = 'status-message warning';
        currentScan = null;
        scanActions.classList.add('hidden');
        barcodeResult.textContent = '';
        initScanner(cameraSelect.value);
    });
    
    // Update attendance table
    function updateAttendanceTable() {
        attendanceTable.innerHTML = '';
        attendanceData.forEach((entry, index) => {
            const row = attendanceTable.insertRow();
            row.insertCell(0).textContent = index + 1;
            row.insertCell(1).textContent = entry.id;
            row.insertCell(2).textContent = entry.time;
            
            const actionCell = row.insertCell(3);
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'warning';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.addEventListener('click', () => {
                attendanceData = attendanceData.filter(item => item.id !== entry.id);
                localStorage.setItem('attendanceData', JSON.stringify(attendanceData));
                updateAttendanceTable();
            });
            actionCell.appendChild(deleteBtn);
        });
    }
    
    // Save to Excel
    saveExcelBtn.addEventListener('click', function() {
        if (attendanceData.length === 0) {
            scanStatus.textContent = 'No attendance data to export.';
            scanStatus.className = 'status-message warning';
            return;
        }
        
        // Format data with proper headers and serial numbers
        const formattedData = attendanceData.map((entry, index) => ({
            'S.No': index + 1,
            'ID Number': entry.id,
            'Department': entry.department,
            'Date': entry.date,
            'Time': entry.time
        }));
        
        // Create worksheet with column headers
        const ws = XLSX.utils.json_to_sheet(formattedData, {
            header: ['S.No', 'ID Number', 'Department', 'Date', 'Time'],
            skipHeader: false
        });
        
        // Set column widths
        ws['!cols'] = [
            { wch: 5 },   // S.No column width
            { wch: 15 },  // ID column width
            { wch: 10 },  // Department column width
            { wch: 12 },  // Date column width
            { wch: 12 }   // Time column width
        ];
        
        // Create workbook and add worksheet
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance");
        
        // Generate filename based on format setting
        const now = new Date();
        let filename = '';
        const format = document.getElementById('filename-format').value;
        
        if (format === 'attendance_YYYY-MM-DD') {
            const dateStr = now.toISOString().split('T')[0];
            filename = `attendance_${dateStr}.xlsx`;
        } else if (format === 'class_YYYYMMDD') {
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            filename = `class_${dateStr}.xlsx`;
        } else {
            filename = `attendance_${now.getTime()}.xlsx`;
        }
        
        // Save the file
        XLSX.writeFile(wb, filename);
        addToHistory(filename, formattedData);
        
        // Clear current attendance data
        attendanceData = [];
        localStorage.removeItem('attendanceData');
        updateAttendanceTable();
        attendanceSection.classList.add('hidden');
    });
    
    // Add to history
    function addToHistory(filename, data) {
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        
        let history = [];
        if (localStorage.getItem('attendanceHistory')) {
            history = JSON.parse(localStorage.getItem('attendanceHistory'));
        }
        
        history.unshift({
            date: dateStr,
            filename: filename,
            timestamp: now.getTime(),
            attendanceData: data
        });
        
        localStorage.setItem('attendanceHistory', JSON.stringify(history));
        loadHistory();
    }
    
    // Load history
    function loadHistory() {
        const emptyMsg = document.querySelector('.history-empty');
        const historyTable = document.getElementById('history-table');
        const tbody = historyTable.querySelector('tbody');
        
        tbody.innerHTML = '';
        
        if (localStorage.getItem('attendanceHistory')) {
            const history = JSON.parse(localStorage.getItem('attendanceHistory'));
            
            if (history.length > 0) {
                historyTable.classList.remove('hidden');
                emptyMsg.classList.add('hidden');
                
                history.forEach((record, index) => {
                    const row = tbody.insertRow();
                    row.insertCell(0).textContent = record.date;
                    row.insertCell(1).textContent = record.filename;
                    row.insertCell(2).textContent = '✅ Saved';
                    
                    const actionCell = row.insertCell(3);
                    actionCell.className = 'action-cell';
                    
                    // Create action buttons container
                    const actionButtons = document.createElement('div');
                    actionButtons.className = 'action-buttons';
                    
                    // Download button
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'success';
                    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
                    downloadBtn.addEventListener('click', () => {
                        downloadHistoryFile(record.filename, record.attendanceData);
                    });
                    
                    // Share button (new)
                    const shareBtn = document.createElement('button');
                    shareBtn.className = 'info';
                    shareBtn.innerHTML = '<i class="fas fa-share"></i> Share';
                    shareBtn.addEventListener('click', () => {
                        shareAttendanceData(record.attendanceData);
                    });
                    
                    // Delete button
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'danger';
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
                    deleteBtn.addEventListener('click', () => {
                        showDeleteModal(record.filename, index);
                    });
                    
                    // Append buttons to container
                    actionButtons.appendChild(downloadBtn);
                    actionButtons.appendChild(shareBtn);
                    actionButtons.appendChild(deleteBtn);
                    
                    // Append container to cell
                    actionCell.appendChild(actionButtons);
                });
            } else {
                historyTable.classList.add('hidden');
                emptyMsg.classList.remove('hidden');
            }
        } else {
            historyTable.classList.add('hidden');
            emptyMsg.classList.remove('hidden');
        }
    }
    
    // Enhanced WhatsApp sharing function
    function shareAttendanceData(data) {
        if (!data || data.length === 0) {
            alert('No attendance data to share.');
            return;
        }

        // Calculate latecomers by department and prepare detailed list
        const departmentCounts = {};
        const latecomersList = {};
        
        data.forEach(entry => {
            if (!departmentCounts[entry.Department]) {
                departmentCounts[entry.Department] = 0;
                latecomersList[entry.Department] = [];
            }
            departmentCounts[entry.Department]++;
            latecomersList[entry.Department].push({
                id: entry['ID Number'],
                time: entry.Time
            });
        });

        // Create a more attractive message with better formatting
        let message = "📋 *LATE COMERS REGISTRY* 📋\n\n";
        message += "================================\n";
        message += "*📅 Date:* " + new Date().toLocaleDateString() + "\n";
        message += "*🕒 Generated at:* " + new Date().toLocaleTimeString() + "\n";
        message += "*👥 Total Latecomers:* " + data.length + "\n";
        message += "================================\n\n";
        
        // Add department summary with emojis
        message += "*📊 Department-wise Summary:*\n";
        message += "--------------------------------\n";
        
        // Sort departments alphabetically
        const sortedDepartments = Object.keys(departmentCounts).sort();
        
        // Find maximum department name length for alignment
        const maxDeptLength = Math.max(...sortedDepartments.map(dept => dept.length));
        
        for (const dept of sortedDepartments) {
            const deptDisplay = dept.padEnd(maxDeptLength);
            const countDisplay = departmentCounts[dept].toString().padStart(3);
            message += `🔹 ${deptDisplay} : ${countDisplay} student(s)\n`;
        }
        
        message += "\n*📝 Latecomers Details:*\n";
        message += "--------------------------------\n";
        
        // Add detailed list by department
        for (const dept of sortedDepartments) {
            message += `\n*🏷 ${dept} Department (${departmentCounts[dept]})*\n`;
            
            // Group by first 4 digits (assuming year part of ID)
            const yearGroups = {};
            latecomersList[dept].forEach(student => {
                const yearPrefix = student.id.substring(0, 2);
                if (!yearGroups[yearPrefix]) {
                    yearGroups[yearPrefix] = [];
                }
                yearGroups[yearPrefix].push(student);
            });
            
            for (const year in yearGroups) {
                yearGroups[year].forEach((student) => {
                    message += ` ${student.id} (🕒 ${student.time})\n`;
                });
            }
        }
        
        message += "\n================================\n";
        message += "*Generated by NEC Latecomer Detection System*\n";
        // Encode the message for WhatsApp URL
        const encodedMessage = encodeURIComponent(message);
        const phoneNumber = "919441895535";
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;

        // Open in new tab
        window.open(whatsappUrl, '_blank');
        
        // Show success message
        const status = document.createElement('div');
        status.className = 'status-message success';
        status.textContent = 'Opening WhatsApp to share attendance report...';
        document.getElementById('history').prepend(status);
        
        setTimeout(() => {
            status.remove();
        }, 3000);
    }

    // Download history file
    function downloadHistoryFile(filename, data) {
        if (!data || data.length === 0) {
            alert('No attendance data found for this file.');
            return;
        }
        
        // Create worksheet with proper formatting
        const ws = XLSX.utils.json_to_sheet(data, {
            header: ['S.No', 'ID Number', 'Department', 'Date', 'Time'],
            skipHeader: false
        });
        
        // Set column widths
        ws['!cols'] = [
            { wch: 5 },   // S.No column width
            { wch: 15 },  // ID column width
            { wch: 10 },  // Department column width
            { wch: 12 },  // Date column width
            { wch: 12 }   // Time column width
        ];
        
        // Create workbook and save
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance");
        XLSX.writeFile(wb, filename);
        
        // Show success message
        const status = document.createElement('div');
        status.className = 'status-message success';
        status.textContent = `File "${filename}" downloaded successfully`;
        document.getElementById('history').prepend(status);
        
        setTimeout(() => {
            status.remove();
        }, 3000);
    }
    
    // Show delete modal
    function showDeleteModal(filename, index) {
        currentFileToDelete = { filename, index };
        deleteModal.style.display = 'block';
    }
    
    // Delete file
    function deleteFile() {
        let history = JSON.parse(localStorage.getItem('attendanceHistory'));
        if (history && currentFileToDelete) {
            history.splice(currentFileToDelete.index, 1);
            localStorage.setItem('attendanceHistory', JSON.stringify(history));
            loadHistory();
            deleteModal.style.display = 'none';
            
            const status = document.createElement('div');
            status.className = 'status-message success';
            status.textContent = `File "${currentFileToDelete.filename}" deleted successfully`;
            document.getElementById('history').prepend(status);
            
            setTimeout(() => {
                status.remove();
            }, 3000);
        }
    }
    
    // Clear history
    clearHistoryBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
            localStorage.removeItem('attendanceHistory');
            loadHistory();
            
            const status = document.createElement('div');
            status.className = 'status-message success';
            status.textContent = 'All history cleared successfully';
            document.getElementById('history').prepend(status);
            
            setTimeout(() => {
                status.remove();
            }, 3000);
        }
    });
    
    // Refresh history
    refreshHistoryBtn.addEventListener('click', loadHistory);
    
    // Load settings
    function loadSettings() {
        if (localStorage.getItem('attendanceSettings')) {
            const settings = JSON.parse(localStorage.getItem('attendanceSettings'));
            document.getElementById('default-camera').value = settings.defaultCamera || 'auto';
            document.getElementById('filename-format').value = settings.filenameFormat || 'attendance_YYYY-MM-DD';
            document.getElementById('enable-sound').checked = settings.enableSound !== false;
            document.getElementById('enable-vibration').checked = settings.enableVibration !== false;
        }
    }
    
    // Save settings
    saveSettingsBtn.addEventListener('click', function() {
        const settings = {
            defaultCamera: document.getElementById('default-camera').value,
            filenameFormat: document.getElementById('filename-format').value,
            enableSound: document.getElementById('enable-sound').checked,
            enableVibration: document.getElementById('enable-vibration').checked
        };
        
        localStorage.setItem('attendanceSettings', JSON.stringify(settings));
        
        settingsStatus.textContent = 'Settings saved successfully.';
        settingsStatus.className = 'status-message success';
        settingsStatus.classList.remove('hidden');
        
        setTimeout(() => {
            settingsStatus.classList.add('hidden');
        }, 3000);
    });
    
    // Initialize the application
    init();
});
