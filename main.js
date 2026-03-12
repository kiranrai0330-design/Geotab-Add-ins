geotab.addin.descartesDashboard = () => {
    let api;

    return {
        initialize(geotabApi, state, callback) {
            api = geotabApi;
            
            // Set default dates (last 5 days)
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 5);
            document.getElementById('dateStart').value = start.toISOString().split('T')[0];
            document.getElementById('dateEnd').value = end.toISOString().split('T')[0];

            document.getElementById('refreshBtn').addEventListener('click', () => this.update());
            callback();
        },

        async update() {
            const fromDate = document.getElementById('dateStart').value;
            const toDate = document.getElementById('dateEnd').value;

            // 1. Get all Trips (to see who drove what and how far)
            const trips = await api.call("Get", {
                typeName: "Trip",
                search: { fromDate, toDate }
            });

            // 2. Get all DVIR Logs
            const dvirs = await api.call("Get", {
                typeName: "DVIRLog",
                search: { fromDate, toDate }
            });

            this.render(trips, dvirs);
        },

        render(trips, dvirs) {
            const reportData = {}; // Structure: { driverName: { date: { miles, vehicles: Set(), inspections: 0 } } }
            
            // Process Trips
            trips.forEach(t => {
                const d = t.driver.id;
                const date = t.start.split('T')[0];
                if (!reportData[d]) reportData[d] = { name: t.driver.name || d, days: {} };
                if (!reportData[d].days[date]) reportData[d].days[date] = { miles: 0, vehicles: new Set(), inspections: 0 };
                
                reportData[d].days[date].miles += t.distance;
                reportData[d].days[date].vehicles.add(t.device.id);
            });

            // Process DVIRs
            dvirs.forEach(log => {
                const d = log.driver.id;
                const date = log.dateTime.split('T')[0];
                if (reportData[d] && reportData[d].days[date]) {
                    reportData[d].days[date].inspections++;
                }
            });

            // Render Table and Calculate KPIs
            const tbody = document.getElementById('reportContent');
            tbody.innerHTML = '';
            
            let redCount = 0, yellowCount = 0, greenCount = 0;

            Object.values(reportData).forEach(driver => {
                const row = document.createElement('tr');
                row.innerHTML = `<td>${driver.name}</td>`;
                
                // Logic for coloring
                Object.keys(driver.days).forEach(date => {
                    const day = driver.days[date];
                    const vehicleCount = day.vehicles.size;
                    let statusClass = 'gray';

                    if (day.miles > 0) {
                        if (day.inspections === 0) {
                            statusClass = 'red';
                            redCount++;
                        } else if (day.inspections < vehicleCount) {
                            statusClass = 'yellow';
                            yellowCount++;
                        } else {
                            statusClass = 'green';
                            greenCount++;
                        }
                    }

                    row.innerHTML += `
                        <td class="cell-${statusClass}">
                            <div class="val">Insp: ${day.inspections}/${vehicleCount}</div>
                            <div class="sub">${Math.round(day.miles)} mi</div>
                        </td>`;
                });
                tbody.appendChild(row);
            });

            // Update KPIs
            document.getElementById('kpi-missing').innerText = redCount;
            document.getElementById('kpi-partial').innerText = yellowCount;
            document.getElementById('kpi-compliant').innerText = greenCount;
            const total = redCount + yellowCount + greenCount;
            document.getElementById('kpi-score').innerText = total ? Math.round((greenCount / total) * 100) + '%' : '0%';
        }
    };
};