"""API smoke tests.  Run:  python test_api.py   (uses a temporary database)"""
import io
import os
import sys
import tempfile
import unittest

_tmp = tempfile.mkdtemp()
os.environ["SV_DB"] = os.path.join(_tmp, "test.db")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as A  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 50


def login(user, pw):
    c = A.app.test_client()
    r = c.post("/api/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.json
    return c


class SmokeTests(unittest.TestCase):
    def test_auth_and_roles(self):
        self.assertEqual(A.app.test_client().post("/api/login", json={"username": "admin", "password": "bad"}).status_code, 401)
        self.assertIsNone(A.app.test_client().get("/api/me").json)
        citizen = login("ramesh", "citizen123")
        for url in ("/api/citizens", "/api/audit", "/api/staff", "/api/reports/summary"):
            self.assertEqual(citizen.get(url).status_code, 403, url)
        self.assertEqual(citizen.post("/api/notices", json={"title": "x", "content": "y"}).status_code, 403)

    def test_complaint_lifecycle(self):
        citizen, head = login("sunita", "citizen123"), login("works_head", "staff123")
        worker, other = login("works_worker", "staff123"), login("water_worker", "staff123")
        r = citizen.post("/api/complaints", data={"title": "Hole", "description": "d", "category_id": "3",
                                                 "photos": (io.BytesIO(PNG), "a.png")}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 201, r.json)
        cid, ref = r.json["id"], r.json["reference_code"]
        bad = citizen.post("/api/complaints", data={"title": "Bad", "description": "d", "category_id": "3",
                                                    "photos": (io.BytesIO(b"<script>"), "a.png")}, content_type="multipart/form-data")
        self.assertEqual(bad.status_code, 400)
        fid = citizen.get(f"/api/complaints/{cid}").json["files"][0]["id"]
        self.assertEqual(citizen.get(f"/api/files/{fid}").status_code, 200)
        self.assertEqual(login("ganesh", "citizen123").get(f"/api/files/{fid}").status_code, 404)
        self.assertEqual(other.get(f"/api/complaints/{cid}").status_code, 404)
        self.assertEqual(head.post(f"/api/complaints/{cid}/assign", json={"assigned_to": 6}).status_code, 200)
        self.assertEqual(worker.post(f"/api/complaints/{cid}/transition", json={"status": "RESOLVED"}).status_code, 403)
        self.assertEqual(worker.post(f"/api/complaints/{cid}/transition", json={"status": "IN_PROGRESS"}).status_code, 200)
        self.assertEqual(worker.post(f"/api/complaints/{cid}/transition", json={"status": "RESOLVED", "note": "done"}).status_code, 200)
        self.assertEqual(citizen.post(f"/api/complaints/{cid}/feedback", json={"rating": 5}).status_code, 200)
        self.assertEqual(citizen.post(f"/api/complaints/{cid}/transition", json={"status": "REOPENED", "note": "again"}).status_code, 200)
        self.assertEqual(A.app.test_client().get(f"/api/public/track/{ref}").json["status"], "REOPENED")

    def test_bills_and_admin(self):
        admin, citizen = login("admin", "admin123"), login("ramesh", "citizen123")
        bills = citizen.get("/api/bills").json
        unpaid = next(b for b in bills if b["status"] == "Unpaid")
        self.assertEqual(citizen.post(f"/api/bills/{unpaid['id']}/pay").status_code, 200)
        self.assertEqual(citizen.post(f"/api/bills/{unpaid['id']}/pay").status_code, 400)
        self.assertEqual(admin.get("/api/reports/export/complaints").status_code, 200)
        self.assertEqual(admin.post("/api/staff", json={"name": "T", "username": "t_worker", "password": "secret1",
                                                       "role": "field_worker", "department_id": 1}).status_code, 201)


if __name__ == "__main__":
    unittest.main(verbosity=2)
