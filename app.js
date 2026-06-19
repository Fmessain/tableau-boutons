tableau.extensions.initializeAsync().then(() => {
    const dashboard = tableau.extensions.dashboardContent.dashboard;

    dashboard.getParametersAsync().then((params) => {
        console.log("Paramètres disponibles :");
        params.forEach(p => console.log(p.name, "→", p.currentValue.value));
    });

}).catch((err) => {
    console.error("Erreur init :", err);
});
