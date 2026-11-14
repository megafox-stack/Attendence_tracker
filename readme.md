Attendance Tracker

An Android application designed to help students monitor and manage their academic attendance efficiently.

The application simplifies attendance tracking by combining timetable-based attendance management, manual attendance updates, and automatic attendance calculations in one place.

Features

- Attendance Dashboard: View overall attendance statistics and subject-wise attendance percentages.
- Timetable Management: Maintain a recurring weekly class timetable.
- Automatic Attendance Tracking: Generate attendance records based on scheduled classes.
- Attendance Confirmation: Review and update attendance records as Present or Absent.
- Manual Attendance: Add or modify attendance records manually.
- Attendance Calculation: Automatically calculate attendance percentages for individual subjects.
- Offline Functionality: Store and manage attendance data locally without requiring an internet connection.

Screens

The application is organized into the following main sections:

1. Home: Overview of attendance statistics.
2. Attendance: Subject-wise attendance records and percentages.
3. Timetable: Manage the weekly class schedule.
4. Manual Attendance: Add and modify attendance records.

Tech Stack

Technology| Purpose
Kotlin| Application development
Jetpack Compose| UI development
Room Database| Local data persistence
SQLite| Local database storage
WorkManager| Background task scheduling
Android Studio| Development environment

Architecture

The application uses a local-first architecture.

- Kotlin handles application logic.
- Jetpack Compose provides the user interface.
- Room Database manages persistent local storage.
- WorkManager handles scheduled background operations.
- Multiple Activities organize the application's screens.

All attendance data is stored locally on the device. The application does not depend on a cloud database or external server.

Installation

1. Download the APK from the Releases section of this repository.
2. Open the downloaded APK on your Android device.
3. Allow installation from the relevant source if prompted.
4. Complete the installation and start tracking attendance.

Development Setup

To run the project locally:

1. Clone this repository:
   
   git clone https://github.com/YOUR_USERNAME/Attendence_tracker.git

2. Open the project in Android Studio.

3. Allow Gradle to synchronize the project.

4. Connect an Android device or start an emulator.

5. Build and run the application.

Project Objective

This project was developed to address a common problem faced by college students: the lack of convenient, up-to-date attendance tracking.

Instead of depending entirely on delayed attendance updates from college platforms, students can maintain their own attendance records and monitor their attendance throughout the semester.

Future Improvements

- Timetable import functionality.
- Enhanced attendance data management.
- Additional data export and backup options.
- Improved application security.

Project Information

Project Type: Personal Android Development Project

Platform: Android

Development Language: Kotlin

Storage: Local Database (Room / SQLite)

---

Developed as a personal project to improve student productivity and attendance management.