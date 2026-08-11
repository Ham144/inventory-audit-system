import "dotenv/config";
import { prisma } from "./config/db.js";
import { getMappings } from "./utils/office-mapping.js";

async function main() {
  const mappings = await getMappings();
  
  for (const mapping of mappings) {
    const { officeName, locationCode } = mapping;
    
    const sessions = await prisma.opnameSession.findMany({
      where: { office: locationCode.toUpperCase() }
    });
    
    for (const session of sessions) {
      console.log(`Migrating session ${session.id} from ${session.office} to ${officeName}`);
      
      // Update session office
      await prisma.opnameSession.update({
        where: { id: session.id },
        data: { office: officeName }
      });
      
      // Update scan logs
      await prisma.scanLog.updateMany({
        where: { sessionId: session.id, office: locationCode.toUpperCase() },
        data: { office: officeName }
      });
    }
  }
  console.log("Migration complete.");
}

main().catch(console.error);
