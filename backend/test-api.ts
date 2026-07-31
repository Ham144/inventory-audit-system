import axios from "axios";

async function run() {
  try {
    const res = await axios.get("http://localhost:3000/api/compare/scan", {
      params: { office: "Semua", rak: "Semua", search: "" }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e.response?.data || e.message);
  }
}

run();
