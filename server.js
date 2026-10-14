const App = require("./src/app");
const Database = require("./src/config/database");
const config = require("./src/config/env");

class Server {
  constructor() {
    this.database = new Database(config.mongoUri);
    this.app = new App(config).instance;
  }

  async start() {
    await this.database.connect();
    this.app.listen(config.port, () =>
      console.log(`Server running on port ${config.port}`)
    );
  }
}

new Server().start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
