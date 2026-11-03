from conftest import login

API = "/api/v1"


def register(client, name, email, role="student", password="secret12"):
    r = client.post(
        f"{API}/auth/register", json={"name": name, "email": email, "password": password, "role": role}
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_auth_basics(client):
    data = register(client, "Sam Student", "sam@test.dev")
    assert data["user"]["role"] == "student"
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    assert client.get(f"{API}/auth/me", headers=headers).json()["email"] == "sam@test.dev"

    # duplicate email, bad password, no token
    assert client.post(f"{API}/auth/register", json={"name": "Sam", "email": "sam@test.dev", "password": "secret12"}).status_code == 409
    assert client.post(f"{API}/auth/login", json={"email": "sam@test.dev", "password": "wrong"}).status_code == 401
    assert client.get(f"{API}/auth/me").status_code == 401


def test_role_protection(client, admin_h):
    stu = login(client, "sam@test.dev", "secret12")
    assert client.post(f"{API}/courses", json={"title": "Hack"}, headers=stu).status_code == 403
    assert client.get(f"{API}/admin/users", headers=stu).status_code == 403
    assert client.get(f"{API}/admin/users", headers=admin_h).status_code == 200


def test_full_learning_flow(client, admin_h):
    # --- teacher registers, must be approved by admin
    pending = register(client, "Tina Teacher", "tina@test.dev", role="teacher")
    assert pending["pending_approval"] is True
    r = client.post(f"{API}/auth/login", json={"email": "tina@test.dev", "password": "secret12"})
    assert r.status_code == 403

    users = client.get(f"{API}/admin/users", params={"search": "tina"}, headers=admin_h).json()["items"]
    tina_id = users[0]["id"]
    r = client.put(f"{API}/admin/users/{tina_id}", json={"is_active": True}, headers=admin_h)
    assert r.status_code == 200 and r.json()["is_active"] is True
    teacher = login(client, "tina@test.dev", "secret12")

    # --- teacher builds a course
    course = client.post(f"{API}/courses", json={"title": "Algebra 101", "description": "x", "category": "Math"}, headers=teacher).json()
    cid = course["id"]
    assert course["status"] == "draft"

    # cannot submit for review without lessons
    assert client.post(f"{API}/courses/{cid}/submit-review", headers=teacher).status_code == 400

    lesson = client.post(f"{API}/courses/{cid}/lessons", json={"title": "Intro", "content": "Hello"}, headers=teacher).json()
    lesson2 = client.post(f"{API}/courses/{cid}/lessons", json={"title": "Second"}, headers=teacher).json()
    r = client.post(f"{API}/courses/{cid}/lessons/reorder", json={"ids": [lesson2["id"], lesson["id"]]}, headers=teacher)
    assert r.status_code == 200

    assign = client.post(
        f"{API}/courses/{cid}/assignments",
        json={"title": "HW1", "description": "Solve", "due_date": "2030-01-01T00:00:00Z", "max_score": 10},
        headers=teacher,
    ).json()
    quiz = client.post(
        f"{API}/courses/{cid}/quizzes",
        json={"title": "Q1", "questions": [{"text": "1+1?", "options": ["1", "2"], "correct_index": 1}]},
        headers=teacher,
    ).json()
    assert client.post(
        f"{API}/courses/{cid}/quizzes",
        json={"title": "Bad", "questions": [{"text": "?", "options": ["a", "b"], "correct_index": 5}]},
        headers=teacher,
    ).status_code == 422

    # --- not visible to students until approved
    stu = login(client, "sam@test.dev", "secret12")
    assert client.post(f"{API}/courses/{cid}/enroll", headers=stu).status_code == 404
    assert client.post(f"{API}/courses/{cid}/submit-review", headers=teacher).status_code == 200
    r = client.put(f"{API}/admin/courses/{cid}/status", json={"status": "published"}, headers=admin_h)
    assert r.json()["status"] == "published"

    # --- student enrolls and learns
    cat = client.get(f"{API}/courses", params={"search": "algebra"}, headers=stu).json()
    assert cat["total"] == 1 and cat["items"][0]["enrolled"] is False
    # before enrolling: no lesson content
    detail = client.get(f"{API}/courses/{cid}", headers=stu).json()
    assert detail["has_access"] is False and "content" not in detail["lessons"][0]

    assert client.post(f"{API}/courses/{cid}/enroll", headers=stu).status_code == 201
    assert client.post(f"{API}/courses/{cid}/enroll", headers=stu).status_code == 409
    detail = client.get(f"{API}/courses/{cid}", headers=stu).json()
    assert detail["has_access"] and detail["lessons"][0]["title"] == "Second"  # reordered

    r = client.post(f"{API}/lessons/{lesson['id']}/complete", headers=stu)
    assert r.json()["progress"] == 50

    # assignment submit (text + file), then regrade rules
    r = client.post(
        f"{API}/assignments/{assign['id']}/submit",
        data={"text": "my answer"},
        files={"file": ("answer.txt", b"hello world", "text/plain")},
        headers=stu,
    )
    assert r.status_code == 200, r.text
    sub_id = r.json()["id"]

    dl = client.get(f"{API}/submissions/{sub_id}/file", headers=stu)
    assert dl.status_code == 200 and dl.content == b"hello world"
    other = register(client, "Other Student", "other@test.dev")
    other_h = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get(f"{API}/submissions/{sub_id}/file", headers=other_h).status_code == 403

    # disallowed file type
    r = client.post(
        f"{API}/assignments/{assign['id']}/submit",
        data={"text": "x"},
        files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
        headers=stu,
    )
    assert r.status_code == 400

    # teacher grades
    subs = client.get(f"{API}/assignments/{assign['id']}/submissions", headers=teacher).json()
    assert len(subs["submissions"]) == 1
    assert client.put(f"{API}/submissions/{sub_id}/grade", json={"score": 99}, headers=teacher).status_code == 400
    r = client.put(f"{API}/submissions/{sub_id}/grade", json={"score": 9, "feedback": "Nice"}, headers=teacher)
    assert r.status_code == 200 and r.json()["score"] == 9
    # graded work is locked
    assert client.post(f"{API}/assignments/{assign['id']}/submit", data={"text": "again"}, headers=stu).status_code == 400

    # quiz
    q = client.get(f"{API}/quizzes/{quiz['id']}", headers=stu).json()
    assert "correct_index" not in q["questions"][0]
    r = client.post(f"{API}/quizzes/{quiz['id']}/attempt", json={"answers": [1]}, headers=stu).json()
    assert r["score"] == 1 and r["percent"] == 100
    assert client.post(f"{API}/quizzes/{quiz['id']}/attempt", json={"answers": []}, headers=stu).status_code == 400

    # announcement + dashboards + grades
    assert client.post(f"{API}/courses/{cid}/announcements", json={"message": "Hi all"}, headers=teacher).status_code == 201
    dash = client.get(f"{API}/me/dashboard", headers=stu).json()
    assert dash["stats"]["enrolled"] == 1 and dash["stats"]["avg_grade"] is not None
    assert dash["announcements"][0]["message"] == "Hi all"
    grades = client.get(f"{API}/me/grades", headers=stu).json()
    assert grades["assignments"][0]["score"] == 9 and grades["quizzes"][0]["best"] == 1

    summary = client.get(f"{API}/teacher/summary", headers=teacher).json()
    assert summary["stats"]["students"] == 1 and summary["stats"]["courses"] == 1
    roster = client.get(f"{API}/courses/{cid}/students", headers=teacher).json()
    assert roster[0]["progress"] == 50

    # another teacher can't touch it
    register(client, "Rival", "rival@test.dev", role="teacher")
    rid = client.get(f"{API}/admin/users", params={"search": "rival"}, headers=admin_h).json()["items"][0]["id"]
    client.put(f"{API}/admin/users/{rid}", json={"is_active": True}, headers=admin_h)
    rival = login(client, "rival@test.dev", "secret12")
    assert client.put(f"{API}/courses/{cid}", json={"title": "Stolen"}, headers=rival).status_code == 403
    assert client.delete(f"{API}/courses/{cid}", headers=rival).status_code == 403

    # delete cascades
    assert client.delete(f"{API}/courses/{cid}", headers=teacher).status_code == 204
    assert client.get(f"{API}/courses/{cid}", headers=stu).status_code == 404


def test_admin_management(client, admin_h):
    stats = client.get(f"{API}/admin/stats", headers=admin_h).json()
    assert stats["users"]["admin"] >= 1 and len(stats["signups"]) == 7

    created = client.post(
        f"{API}/admin/users",
        json={"name": "Made By Admin", "email": "made@test.dev", "password": "secret12", "role": "teacher"},
        headers=admin_h,
    )
    assert created.status_code == 201
    uid = created.json()["id"]

    # cannot lock yourself out
    me = client.get(f"{API}/auth/me", headers=admin_h).json()
    assert client.put(f"{API}/admin/users/{me['id']}", json={"role": "student"}, headers=admin_h).status_code == 400
    assert client.delete(f"{API}/admin/users/{me['id']}", headers=admin_h).status_code == 400

    # deactivated users are locked out immediately
    victim = register(client, "Victim", "victim@test.dev")
    vh = {"Authorization": f"Bearer {victim['access_token']}"}
    vid = victim["user"]["id"]
    client.put(f"{API}/admin/users/{vid}", json={"is_active": False}, headers=admin_h)
    assert client.get(f"{API}/auth/me", headers=vh).status_code == 401

    assert client.delete(f"{API}/admin/users/{uid}", headers=admin_h).status_code == 204
    log = client.get(f"{API}/admin/audit-log", headers=admin_h).json()
    assert log["total"] > 0 and any(i["action"] == "admin.user.delete" for i in log["items"])
