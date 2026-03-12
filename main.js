geotab.addin.descartesDashboard = () => {
    let api;
    let masterData = {}; 
    let currentDates = [];

    return {
        initialize(geotabApi, state, callback) {
            api = geotabApi;
            
            // Default range: Last 7 days
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 6);
            document.getElementById('dateStart').value = start.toISOString().split('T')[0];
            document.getElementById('dateEnd').value = end.toISOString().split('T')[0];

            document.getElementById('refreshBtn').addEventListener('click', () => this.update());
            document.getElementById('exportBtn').addEventListener('click', () => this.exportToCSV());

            this.update();
            callback();
        },

        async update() {
            const startVal = document.getElementById('dateStart').value;
            const endVal = document.getElementById('dateEnd').value;
            
            // 1. Force generate date headers immediately based on calendar selection
            masterData = {};
            currentDates = [];
            let tempDate = new Date(startVal + 'T00:00:00');
            const stopDate = new Date(endVal + 'T00:00:00');
            
            while (tempDate <= stopDate) {
                currentDates.push(tempDate.toISOString().split('T')[0]);
                tempDate.setDate(tempDate.getDate() + 1);
            }

            try {
                // 2. Fetch Data with safety catches for each call
                const fromDate = new Date(startVal).toISOString();
                const toDate = new Date(endVal).toISOString();

                const [trips, dvirs, users, groups, devices] = await Promise.all([
                    api.call("Get", { typeName: "Trip", search: { fromDate, toDate } }).catch(() => []),
                    api.call("Get", { typeName: "DVIRLog", search: { fromDate, toDate } }).catch(() => []),
                    api.call("Get", { typeName: "User" }).catch(() => []),
                    api.call("Get", { typeName: "Group" }).catch(() => []),
                    api.call("Get", { typeName: "Device" }).catch(() => [])
                ]);

                const groupMap = groups.reduce((acc, g) => ({ ...acc, [g.id]: g.name }), {});
                const userMap = users.reduce((acc, u) => ({ ...acc, [u.id]: u }), {});
                const deviceMap = devices.reduce((acc, v) => ({ ...acc, [v.id]: v.name }), {});

                // 3. Process Trips into Master Data
                trips.forEach(t => {
                    if (!t.driver || !t.driver.id) return;
                    const dId = t.driver.id;
                    const date = t.start.split('T')[0];

                    if (!masterData[dId]) {
                        const u = userMap[dId] || {};
                        // Fix for 'undefined' - check every possible name field
                        let firstName = u.firstName || "";
                        let lastName = u.lastName || "";
                        let fullName = (firstName + " " + lastName).trim();
                        if (!fullName) fullName = u.name || dId; // Fallback to email/username or ID

                        masterData[dId] = {
                            name: fullName,
                            email: u.name || "N/A",
                            groups: (u.companyGroups || []).map(g => groupMap[g.id] || g.id).join(', ') || 'General',
                            days: {}
                        };
                    }

                    if (!masterData[dId].days[date]) {
                        masterData[dId].days[date] = { miles: 0, vehicles: new Set(), inspections: 0 };
                    }
                    masterData[dId].days[date].miles += t.distance;
                    masterData[dId].days[date].vehicles.add(deviceMap[t.device.id] || t.device.id);
                });

                // 4. Match DVIRs to the driver and day
                dvirs.forEach(log => {
                    const dId = log.driver.id;
                    const date = log.dateTime.split('T')[0];
                    if (masterData[dId] && masterData[dId].days[date]) {
                        masterData[dId].days[date].inspections++;
                    }
                });

                this.render();
            } catch (err) {
                console.error("Dashboard failed to update:", err);
            }
        },

        render() {
            const tbody = document.getElementById('reportContent');
            const headerRow = document.getElementById('headerRow');
            
            // Build Headers
            headerRow.innerHTML = '<th>Driver Details</th>';
            currentDates.forEach(d => {
                const dateObj = new Date(d + 'T00:00:00');
                const display = dateObj.toLocaleDateString(undefined, {month:'short', day:'numeric'});
                headerRow.innerHTML += `<th>${display}</th>`;
            });

            tbody.innerHTML = '';
            let red = 0, yellow = 0, green = 0;

            // Build Rows
            Object.values(masterData).sort((a,b) => a.name.localeCompare(b.name)).forEach(driver => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="driver-cell">
                        <div class="d-name">${driver.name}</div>
                        <div class="d-email">${driver.email}</div>
                        <div class="d-group">${driver.groups}</div>
                    </td>`;

                currentDates.forEach(date => {
                    const day = driver.days[date];
                    if (!day || day.miles === 0) {
                        row.innerHTML += `<td class="cell-empty">No Activity</td>`;
                        return;
                    }

                    const vCount = day.vehicles.size;
                    let status = 'green';
                    if (day.inspections === 0) { status = 'red'; red++; }
                    else if (day.inspections < vCount) { status = 'yellow'; yellow++; }
                    else { green++; }

                    row.innerHTML += `
                        <td class="cell-${status}">
                            <div class="val">${day.inspections} Insp / ${vCount} Veh</div>
                            <div class="sub">${Math.round(day.miles)} mi</div>
                        </td>`;
                });
                tbody.appendChild(row);
            });

            // Update KPIs
            document.getElementById('kpi-missing').innerText = red;
            document.getElementById('kpi-partial').innerText = yellow;
            document.getElementById('kpi-compliant').innerText = green;
            const total = red + yellow + green;
            document.getElementById('kpi-score').innerText = total ? Math.round((green / total) * 100) + '%' : '0%';
        },

        exportToCSV() {
            let csv = 'Driver,Email,Groups,' + currentDates.join(',') + '\n';
            Object.values(masterData).forEach(d => {
                let row = `"${d.name}","${d.email}","${d.groups}"`;
                currentDates.forEach(date => {
                    const day = d.days[date];
                    row += day ? `,"Insp: ${day.inspections} Miles: ${Math.round(day.miles)}"` : ',"-"';
                });
                csv += row + '\n';
            });
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('href', url);
            a.setAttribute('download', 'Inspection_Report.csv');
            a.click();
        }
    };
};