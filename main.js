geotab.addin.descartesDashboard = () => {
    let api;
    let masterData = {}; 
    let groupMap = {};
    let currentDates = [];

    return {
        initialize(geotabApi, state, callback) {
            api = geotabApi;
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 6);
            document.getElementById('dateStart').value = start.toISOString().split('T')[0];
            document.getElementById('dateEnd').value = end.toISOString().split('T')[0];

            document.getElementById('refreshBtn').addEventListener('click', () => this.update());
            document.getElementById('exportBtn').addEventListener('click', () => this.exportToCSV());
            document.getElementById('driverSearch').addEventListener('input', () => this.render());
            document.getElementById('groupFilter').addEventListener('change', () => this.render());

            this.update();
            callback();
        },

        async update() {
            const fromDate = new Date(document.getElementById('dateStart').value).toISOString();
            const toDate = new Date(document.getElementById('dateEnd').value).toISOString();

            // Fetch everything needed for a full report
            const [trips, dvirs, users, groups, devices] = await Promise.all([
                api.call("Get", { typeName: "Trip", search: { fromDate, toDate } }),
                api.call("Get", { typeName: "DVIRLog", search: { fromDate, toDate } }),
                api.call("Get", { typeName: "User" }),
                api.call("Get", { typeName: "Group" }),
                api.call("Get", { typeName: "Device" })
            ]);

            // Map IDs for easy lookup
            groupMap = groups.reduce((acc, g) => ({ ...acc, [g.id]: g.name }), {});
            const userMap = users.reduce((acc, u) => ({ ...acc, [u.id]: u }), {});
            const deviceMap = devices.reduce((acc, v) => ({ ...acc, [v.id]: v.name }), {});

            // Populate Group Filter Dropdown
            const groupSelect = document.getElementById('groupFilter');
            groupSelect.innerHTML = '<option value="all">All Groups</option>';
            groups.sort((a,b) => a.name.localeCompare(b.name)).forEach(g => {
                groupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
            });

            // Reset Master Data
            masterData = {};
            const dateSet = new Set();

            trips.forEach(t => {
                if (!t.driver || t.driver.id === "NoDriverId") return;
                const dId = t.driver.id;
                const date = t.start.split('T')[0];
                dateSet.add(date);

                if (!masterData[dId]) {
                    const u = userMap[dId] || {};
                    masterData[dId] = {
                        name: `${u.firstName || ''} ${u.lastName || 'Unknown'}`.trim(),
                        email: u.name || 'N/A',
                        groups: (u.companyGroups || []).map(g => groupMap[g.id] || g.id).join(', '),
                        groupIds: (u.companyGroups || []).map(g => g.id),
                        days: {}
                    };
                }

                if (!masterData[dId].days[date]) {
                    masterData[dId].days[date] = { miles: 0, vehicles: new Set(), inspections: 0 };
                }
                masterData[dId].days[date].miles += t.distance;
                masterData[dId].days[date].vehicles.add(deviceMap[t.device.id] || t.device.id);
            });

            dvirs.forEach(log => {
                const dId = log.driver.id;
                const date = log.dateTime.split('T')[0];
                if (masterData[dId] && masterData[dId].days[date]) {
                    masterData[dId].days[date].inspections++;
                }
            });

            currentDates = Array.from(dateSet).sort();
            this.render();
        },

        render() {
            const searchTerm = document.getElementById('driverSearch').value.toLowerCase();
            const selectedGroup = document.getElementById('groupFilter').value;
            const tbody = document.getElementById('reportContent');
            const headerRow = document.getElementById('headerRow');
            
            headerRow.innerHTML = '<th>Driver Details</th>';
            currentDates.forEach(d => {
                headerRow.innerHTML += `<th>${new Date(d + 'T00:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric'})}</th>`;
            });

            tbody.innerHTML = '';
            let red = 0, yellow = 0, green = 0;

            Object.values(masterData).forEach(driver => {
                // Filters
                const matchesSearch = driver.name.toLowerCase().includes(searchTerm) || driver.email.toLowerCase().includes(searchTerm);
                const matchesGroup = selectedGroup === 'all' || driver.groupIds.includes(selectedGroup);
                if (!matchesSearch || !matchesGroup) return;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="driver-cell">
                        <div class="d-name">${driver.name}</div>
                        <div class="d-email">${driver.email}</div>
                        <div class="d-group">${driver.groups}</div>
                    </td>`;

                currentDates.forEach(date => {
                    const day = driver.days[date];
                    if (!day) {
                        row.innerHTML += `<td class="cell-empty">-</td>`;
                        return;
                    }

                    const vCount = day.vehicles.size;
                    const vList = Array.from(day.vehicles).join(', ');
                    let status = 'green';
                    if (day.inspections === 0) { status = 'red'; red++; }
                    else if (day.inspections < vCount) { status = 'yellow'; yellow++; }
                    else { green++; }

                    row.innerHTML += `
                        <td class="cell-${status}">
                            <div class="val">${day.inspections} Insp / ${vCount} Veh</div>
                            <div class="sub">${Math.round(day.miles)} mi</div>
                            <div class="v-list">${vList}</div>
                        </td>`;
                });
                tbody.appendChild(row);
            });

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