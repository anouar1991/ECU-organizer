const path = require('path');
process.chdir('/home/noreddine/ECU-organizer');

const files = [
  '/home/noreddine/Downloads/MED17_5 - ORI.bin',
  '/home/noreddine/Downloads/- VW Caddy 2.0_TDI_CR dpf_OFF.bin',
  '/home/noreddine/Downloads/Nissan_Terrano_2.7_TDI__Turbo-Diesel___91.9KWKW_Bosch_0281010284__354477_43A2.Original.bin',
  '/home/noreddine/Downloads/sdc(Land Rover_EDC17CP11__EGR-_Nodtc).bin.bin',
  '/home/noreddine/Downloads/OCT(Land Rover_EDC17CP11___NoChk) sdc.bin.bin',
  '/home/noreddine/Downloads/kia_bosch_edc17c57_bench_fullbackup_4180870e1540b56d040c002011000000_20250621164953_int_eeprom.bin'
];

const parser     = require('/home/noreddine/ECU-organizer/src/main/ecu-parser');
const comparator = require('/home/noreddine/ECU-organizer/src/main/ecu-comparator');

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ECU PARSER — TEST AGAINST REAL FILES');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];
  for (const f of files) {
    try {
      const t0 = Date.now();
      const meta = await parser.parseFile(f);
      const elapsed = Date.now() - t0;
      const name = path.basename(f);
      console.log(`📄 ${name}`);
      console.log(`   size:        ${(meta.fileSize/1024/1024).toFixed(2)} MB`);
      console.log(`   brand:       ${meta.brand}`);
      console.log(`   model:       ${meta.model}`);
      console.log(`   ECU type:    ${meta.ecuType}`);
      console.log(`   ECU family:  ${meta.ecuFamily || '-'}`);
      console.log(`   HW ID:       ${meta.hwId  || '-'}`);
      console.log(`   SW ID:       ${meta.swId  || '-'}`);
      console.log(`   protocol:    ${meta.protocol.join(', ')}`);
      console.log(`   confidence:  ${meta.confidence}%`);
      console.log(`   md5:         ${meta.md5}`);
      console.log(`   tlsh:        ${(meta.tlsh || '-').substring(0, 32)}${meta.tlsh && meta.tlsh.length > 32 ? '...' : ''}`);
      console.log(`   vag boxes:   ${meta.vagBoxNumbers && meta.vagBoxNumbers.join(', ') || '-'}`);
      console.log(`   enrichment:  ${meta.enrichment ? JSON.stringify(meta.enrichment).substring(0, 100) : '-'}`);
      console.log(`   firmware:    ${meta.firmwareStructure ? `${meta.firmwareStructure.regions?.length || 0} regions (${meta.firmwareStructure.parser || meta.firmwareStructure.detector || '?'})` : '-'}`);
      console.log(`   parse time:  ${elapsed} ms\n`);
      results.push({ file: f, meta });
    } catch (err) {
      console.log(`✗ ${f}: ${err.message}\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  COMPARATOR — Land Rover ORIGINAL vs MODIFIED (EGR-)');
  console.log('═══════════════════════════════════════════════════════\n');

  const a = '/home/noreddine/Downloads/OCT(Land Rover_EDC17CP11___NoChk) sdc.bin.bin';
  const b = '/home/noreddine/Downloads/sdc(Land Rover_EDC17CP11__EGR-_Nodtc).bin.bin';
  const t0 = Date.now();
  const cmp = await comparator.compareFiles(a, b);
  const elapsed = Date.now() - t0;

  console.log(`A:           ${path.basename(a)}`);
  console.log(`B:           ${path.basename(b)}`);
  console.log(`A size:      ${cmp.fileA.size.toLocaleString()} bytes  MD5 ${cmp.fileA.md5}`);
  console.log(`B size:      ${cmp.fileB.size.toLocaleString()} bytes  MD5 ${cmp.fileB.md5}`);
  console.log(`identical:   ${cmp.identical}`);
  console.log(`similarity:  ${cmp.similarity}%`);
  console.log(`bytes equal: ${cmp.bytesEqual.toLocaleString()}`);
  console.log(`bytes diff:  ${cmp.bytesDiffer.toLocaleString()}`);
  console.log(`regions:     ${cmp.totalChangedRegions} (showing ${cmp.changedRegions.length})`);
  console.log(`elapsed:     ${elapsed} ms\n`);

  console.log(`First 5 changed regions:`);
  for (const reg of cmp.changedRegions.slice(0, 5)) {
    console.log(`  @ 0x${reg.offset.toString(16).padStart(8,'0').toUpperCase()} (${reg.length} bytes)`);
    console.log(`     A: ${reg.hexA.substring(0, 47)}${reg.hexA.length > 47 ? '...' : ''}`);
    console.log(`     B: ${reg.hexB.substring(0, 47)}${reg.hexB.length > 47 ? '...' : ''}`);
  }

  const denseBuckets = cmp.heatmap.map((v, i) => ({ i, v })).filter(x => x.v > 0).slice(0, 10);
  console.log(`\nHeatmap buckets with diffs (first 10 of ${cmp.heatmap.filter(v => v > 0).length}):`);
  for (const b of denseBuckets) {
    const start = Math.round(b.i * cmp.comparableLength / 256);
    console.log(`  bucket ${b.i.toString().padStart(3)}  offset 0x${start.toString(16).padStart(6,'0').toUpperCase()}  ${b.v}% changed`);
  }

  process.exit(0);
})();
