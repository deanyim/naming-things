import { describe, expect, it } from "vitest";
import { resolveCategorySpec } from "./category-resolver";
import { extractRecordsFromSource, inspectSourceTables } from "./extractor";

describe("extractRecordsFromSource", () => {
  it("extracts table records with cleaned values and source pointers", () => {
    const spec = resolveCategorySpec("survivor contestants");
    const result = extractRecordsFromSource(spec, {
      url: "https://example.test/survivor",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "text/html",
      rawContent: `
        <h2>Contestants</h2>
        <table class="wikitable" id="cast">
          <tr><th>Name</th><th>Season</th></tr>
          <tr>
            <td><a href="/wiki/Richard_Hatch_(Survivor_contestant)">Richard Hatch</a><sup>[1]</sup></td>
            <td>Borneo</td>
          </tr>
          <tr><td>Sandra Diaz&ndash;Twine</td><td>Pearl Islands</td></tr>
          <tr><td>Parvati Shallow</td><td>Cook Islands</td></tr>
        </table>
      `,
    });

    expect(result.warnings).toEqual([]);
    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Richard Hatch",
      "Sandra Diaz-Twine",
      "Parvati Shallow",
    ]);
    expect(result.records[0]!.sourcePointer).toMatchObject({
      blockType: "table",
      blockId: "cast",
      rowIndex: 0,
      columnName: "Name",
    });
    expect(result.records[0]!.metadata).toMatchObject({
      sourceLink:
        "https://example.test/wiki/Richard_Hatch_(Survivor_contestant)",
    });
  });

  it("aggregates all qualifying tables instead of only the top-scored one", () => {
    const spec = resolveCategorySpec("survivor contestants");
    const result = extractRecordsFromSource(spec, {
      url: "https://example.test/survivor",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "text/html",
      rawContent: `
        <h2>Seasons 1-10</h2>
        <table class="wikitable" id="early">
          <tr><th>Name</th><th>Age</th><th>Hometown</th><th>Profession</th><th>Season</th><th>Finish</th></tr>
          <tr><td>Richard Hatch</td><td>39</td><td>Newport, RI</td><td>Trainer</td><td>Borneo</td><td>Winner</td></tr>
          <tr><td>Sonja Christopher</td><td>63</td><td>Walnut Creek, CA</td><td>Teacher</td><td>Borneo</td><td>16th</td></tr>
          <tr><td>Rudy Boesch</td><td>72</td><td>Virginia Beach, VA</td><td>Retired</td><td>Borneo</td><td>3rd</td></tr>
        </table>
        <h2>Seasons 11-20</h2>
        <table class="wikitable" id="middle">
          <tr><th>Name</th><th>Age</th><th>Hometown</th><th>Profession</th><th>Season</th><th>Finish</th></tr>
          <tr><td>Parvati Shallow</td><td>23</td><td>Los Angeles, CA</td><td>Boxer</td><td>Cook Islands</td><td>6th</td></tr>
          <tr><td>Yul Kwon</td><td>31</td><td>San Mateo, CA</td><td>Consultant</td><td>Cook Islands</td><td>Winner</td></tr>
          <tr><td>Ozzy Lusth</td><td>25</td><td>Venice, CA</td><td>Waiter</td><td>Cook Islands</td><td>Runner-up</td></tr>
        </table>
      `,
    });

    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Richard Hatch",
      "Sonja Christopher",
      "Rudy Boesch",
      "Parvati Shallow",
      "Yul Kwon",
      "Ozzy Lusth",
    ]);
    expect(
      result.records.map((record) => record.sourcePointer.blockId),
    ).toEqual(["early", "early", "early", "middle", "middle", "middle"]);
  });

  it("treats row header cells as answer cells in Wikipedia roster tables", () => {
    const spec = resolveCategorySpec("survivor contestants");
    const result = extractRecordsFromSource(spec, {
      url: "https://example.test/survivor",
      retrievedAt: "2026-05-10T00:00:00.000Z",
      contentHash: "abc",
      contentType: "text/html",
      rawContent: `
        <h2>Seasons 1-10</h2>
        <table class="wikitable" id="row-headers">
          <tr><th>Name</th><th>Age</th><th>Hometown</th><th>Profession</th><th>Season</th><th>Finish</th></tr>
          <tr>
            <th scope="row"><span class="vcard"><span class="fn"><a href="/wiki/Sonja_Christopher">Sonja Christopher</a></span></span></th>
            <td>63</td><td>Walnut Creek, CA</td><td>Teacher</td><td rowspan="3">Borneo</td><td>16th</td>
          </tr>
          <tr>
            <th scope="row"><span class="vcard"><span class="fn">B. B. Andersen</span></span></th>
            <td>64</td><td>Mission Hills, KS</td><td>Real Estate Developer</td><td>15th</td>
          </tr>
          <tr>
            <th scope="row"><span class="vcard"><span class="fn"><a href="/wiki/Richard_Hatch_(Survivor_contestant)">Richard Hatch</a></span></span></th>
            <td>39</td><td>Newport, RI</td><td>Corporate Trainer</td><td>Winner</td>
          </tr>
        </table>
      `,
    });

    expect(result.warnings).toEqual([]);
    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Sonja Christopher",
      "B. B. Andersen",
      "Richard Hatch",
    ]);
  });

  it("extracts people from paired Wikipedia designee tables", () => {
    const spec = resolveCategorySpec("trump administration cabinet members");
    const result = extractRecordsFromSource(spec, {
      url: "https://en.wikipedia.org/wiki/Second_cabinet_of_Donald_Trump",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "application/vnd.mediawiki.parse+json",
      rawContent: `
        <h2>Cabinet</h2>
        <table class="wikitable">
          <tr><th colspan="4">Second cabinet of President Donald Trump</th></tr>
          <tr><td colspan="4">Legend row</td></tr>
          <tr>
            <th>Office<br />Date announced/confirmed</th>
            <th>Designee</th>
            <th>Office<br />Date announced/confirmed</th>
            <th>Designee</th>
          </tr>
          <tr>
            <td><a href="/wiki/United_States_Secretary_of_State">Secretary of State</a></td>
            <td><a href="/wiki/United_States_Senate">U.S. senator</a><br /><b><a href="/wiki/Marco_Rubio">Marco Rubio</a></b><br />from Florida</td>
            <td><a href="/wiki/United_States_Secretary_of_Commerce">Secretary of Commerce</a></td>
            <td><a href="/wiki/Cantor_Fitzgerald">Cantor Fitzgerald</a> CEO<br /><b><a href="/wiki/Howard_Lutnick">Howard Lutnick</a></b><br />from New York</td>
          </tr>
          <tr><th colspan="4">Cabinet-level officials</th></tr>
          <tr>
            <td><a href="/wiki/White_House_Chief_of_Staff">White House Chief of Staff</a></td>
            <td>Political consultant<br /><b><a href="/wiki/Susie_Wiles">Susie Wiles</a></b><br />from Florida</td>
            <td><a href="/wiki/Administrator_of_the_Environmental_Protection_Agency">EPA administrator</a></td>
            <td>Former representative<br /><b><a href="/wiki/Lee_Zeldin">Lee Zeldin</a></b><br />from New York</td>
          </tr>
        </table>
      `,
    });

    expect(result.warnings).toEqual([]);
    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Marco Rubio",
      "Howard Lutnick",
      "Susie Wiles",
      "Lee Zeldin",
    ]);
    expect(result.records[1]!.metadata).toMatchObject({
      sourceLink: "https://en.wikipedia.org/wiki/Howard_Lutnick",
    });
  });

  it("uses later header rows and rowspans in compact Wikipedia tables", () => {
    const spec = resolveCategorySpec("trump administration cabinet members");
    const result = extractRecordsFromSource(spec, {
      url: "https://en.wikipedia.org/wiki/Second_cabinet_of_Donald_Trump",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "application/vnd.mediawiki.parse+json",
      rawContent: `
        <h2>Cabinet</h2>
        <table class="wikitable">
          <tr><th colspan="3">Second Trump cabinet</th></tr>
          <tr><th>Office</th><th>Name</th><th>Term</th></tr>
          <tr><td><a href="/wiki/United_States_Secretary_of_State">Secretary of State</a></td><td><a href="/wiki/Marco_Rubio">Marco Rubio</a></td><td>2025-present</td></tr>
          <tr><td rowspan="2"><a href="/wiki/United_States_Attorney_General">Attorney General</a></td><td><a href="/wiki/Pam_Bondi">Pam Bondi</a></td><td>2025-2026</td></tr>
          <tr><td><a href="/wiki/Todd_Blanche">Todd Blanche</a> <span>(Acting)</span></td><td>2026-present</td></tr>
        </table>
      `,
    });

    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Marco Rubio",
      "Pam Bondi",
      "Todd Blanche",
    ]);
  });

  it("supports source-qualified table selections", () => {
    const spec = resolveCategorySpec("survivor contestants");
    const snapshot = {
      url: "https://example.test/one",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "text/html",
      rawContent: `
        <h2>Contestants</h2>
        <table class="wikitable" id="cast">
          <tr><th>Name</th><th>Season</th></tr>
          <tr><td>Richard Hatch</td><td>Borneo</td></tr>
          <tr><td>Sandra Diaz-Twine</td><td>Pearl Islands</td></tr>
          <tr><td>Parvati Shallow</td><td>Cook Islands</td></tr>
        </table>
      `,
    };

    expect(
      extractRecordsFromSource(spec, snapshot, {
        includeBlockIds: ["https://example.test/two#cast"],
      }).records,
    ).toEqual([]);
    expect(
      extractRecordsFromSource(spec, snapshot, {
        includeBlockIds: ["https://example.test/one#cast"],
      }).records.map((record) => record.rawAnswer),
    ).toEqual(["Richard Hatch", "Sandra Diaz-Twine", "Parvati Shallow"]);
  });

  it("extracts cast members from heading-scoped Wikipedia lists", () => {
    const spec = resolveCategorySpec("dune cast");
    const snapshot = {
      url: "https://en.wikipedia.org/wiki/Dune_(2021_film)",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      contentHash: "abc",
      contentType: "application/vnd.mediawiki.parse+json",
      rawContent: `
        <h2 id="Plot">Plot</h2>
        <ul>
          <li><a href="/wiki/Paul_Atreides">Paul Atreides</a> appears in the story.</li>
          <li><a href="/wiki/Arrakis">Arrakis</a> is a planet.</li>
          <li><a href="/wiki/House_Atreides">House Atreides</a> is central.</li>
        </ul>
        <h2 id="Cast">Cast</h2>
        <ul>
          <li><a href="/wiki/Timoth%C3%A9e_Chalamet">Timothée Chalamet</a> as <a href="/wiki/Paul_Atreides">Paul Atreides</a></li>
          <li><a href="/wiki/Rebecca_Ferguson">Rebecca Ferguson</a> as <a href="/wiki/Lady_Jessica">Lady Jessica</a></li>
          <li><a href="/wiki/Oscar_Isaac">Oscar Isaac</a> as Duke <a href="/wiki/Leto_I_Atreides">Leto Atreides</a></li>
          <li><a href="/wiki/Zendaya">Zendaya</a> as <a href="/wiki/Chani_(character)">Chani</a></li>
        </ul>
      `,
    };

    expect(inspectSourceTables(spec, snapshot)).toMatchObject([
      {
        blockType: "list",
        heading: "Cast",
        rowCount: 4,
        sampleRecords: [
          "Timothée Chalamet",
          "Rebecca Ferguson",
          "Oscar Isaac",
          "Zendaya",
        ],
      },
    ]);

    const result = extractRecordsFromSource(spec, snapshot);
    expect(result.warnings).toEqual([]);
    expect(result.records.map((record) => record.rawAnswer)).toEqual([
      "Timothée Chalamet",
      "Rebecca Ferguson",
      "Oscar Isaac",
      "Zendaya",
    ]);
    expect(result.records[0]!.sourcePointer).toMatchObject({
      blockType: "list",
      blockId: "list-1",
      rowIndex: 0,
    });
    expect(result.records[0]!.metadata).toMatchObject({
      sourceLink: "https://en.wikipedia.org/wiki/Timoth%C3%A9e_Chalamet",
    });
  });
});
